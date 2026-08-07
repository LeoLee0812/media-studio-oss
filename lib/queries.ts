import { sql, isoDaysAgo, isoHoursAgo, parseJsonCol } from "./db";
import type {
  Draft,
  DraftMeta,
  Material,
  Topic,
  MaterialSource,
  Pillar,
  MaterialStatus,
  TopicStatus,
  DraftStatus,
  Platform,
} from "./types";

// ===== 查询看门狗 =====
// 原先（Postgres + pooler）这层要处理「连接池持有已死 socket，查询无限挂起」的问题，
// 所以有一整套超时 → 重建连接池 → 重试的自愈逻辑。
// 换成 D1 之后没有连接池、没有长连接，那套复杂度不需要了；但超时兜底仍然保留：
// D1 偶发抖动时，宁可快速报错让页面显示错误，也不要让请求挂到网关超时。
// guardRead / guardWrite 这两个包装保持不变，是硬约定 #4，调用点不许绕过。
const QUERY_TIMEOUT_MS = 8000;

class QueryTimeoutError extends Error {
  constructor(label: string) {
    super(`数据库查询超时：${label}`);
    this.name = "QueryTimeoutError";
  }
}

function withTimeout<T>(run: () => PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new QueryTimeoutError(label)), ms);
    run().then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export async function guardRead<T>(label: string, run: () => PromiseLike<T>): Promise<T> {
  try {
    return await withTimeout(run, QUERY_TIMEOUT_MS, label);
  } catch (e) {
    if (!(e instanceof QueryTimeoutError)) throw e;
    // 读是幂等的，超时重试一次；日志用 wrangler tail 或 Workers Observability 看
    console.warn(`[db-watchdog] ${label} 首次尝试超时，重试一次`);
    return withTimeout(run, QUERY_TIMEOUT_MS, label);
  }
}

export async function guardWrite<T>(label: string, run: () => PromiseLike<T>): Promise<T> {
  // 写不重试：超时不代表没写进去，重试可能造成重复写入
  return withTimeout(run, QUERY_TIMEOUT_MS * 2, label);
}

// ===== 行解码 =====
// D1 把 JSON 列原样当 TEXT 返回，这里还原成 lib/types.ts 里声明的形状，
// 让上层（含全部前端组件）拿到的对象与 Postgres 时代完全一致。
type Row = Record<string, unknown>;

function toMaterial(r: Row): Material {
  return {
    ...(r as unknown as Material),
    tags: parseJsonCol<string[]>(r.tags, []),
    raw: parseJsonCol<unknown>(r.raw, null),
  };
}

function toTopic(r: Row): Topic {
  return {
    ...(r as unknown as Topic),
    material_ids: parseJsonCol<string[]>(r.material_ids, []),
    research: parseJsonCol<unknown>(r.research, null),
  };
}

function toDraft<T extends Draft>(r: Row): T {
  return {
    ...(r as unknown as T),
    meta: parseJsonCol<DraftMeta | null>(r.meta, null),
  };
}

// ===== 素材 =====
export interface MaterialFilter {
  source?: MaterialSource;
  pillar?: Pillar;
  status?: MaterialStatus;
  q?: string;
  limit?: number;
}

export async function listMaterials(f: MaterialFilter = {}): Promise<Material[]> {
  return guardRead("listMaterials", async () => {
    const conds = [];
    if (f.source) conds.push(sql`source = ${f.source}`);
    if (f.pillar) conds.push(sql`pillar = ${f.pillar}`);
    if (f.status) conds.push(sql`status = ${f.status}`);
    if (f.q) {
      // SQLite 的 like 对 ASCII 天然大小写不敏感，等价于 Postgres 的 ilike
      const like = `%${f.q}%`;
      conds.push(sql`(title like ${like} or summary like ${like} or content like ${like})`);
    }
    let where = sql``;
    conds.forEach((c, i) => {
      where = i === 0 ? sql`where ${c}` : sql`${where} and ${c}`;
    });
    const limit = f.limit ?? 200;
    const rows = await sql<Row>`
      select * from ms_materials ${where}
      order by created_at desc
      limit ${limit}`;
    return rows.map(toMaterial);
  });
}

// 卡片视图所需的轻量列（不含 content/raw 等大字段），供 inbox 一次性全量拉取、客户端瞬时筛选
export type MaterialCard = Pick<
  Material,
  | "id" | "source" | "title" | "title_en" | "summary" | "url"
  | "pillar" | "tags" | "status" | "created_at" | "published_at"
>;

// 拉全部素材的轻量列，供 inbox 客户端筛选/搜索（零往返）。默认上限 2000 足够覆盖全库。
// 服务端固定按入库时间倒序：即使全库超过 limit，截断掉的也是最旧的；展示排序全在客户端做。
export async function listMaterialsLite(limit = 2000): Promise<MaterialCard[]> {
  return guardRead("listMaterialsLite", async () => {
    const rows = await sql<Row>`
      select id, source, title, title_en, summary, url, pillar, tags, status, created_at, published_at
      from ms_materials
      order by created_at desc
      limit ${limit}`;
    return rows.map((r) => ({
      ...(r as unknown as MaterialCard),
      tags: parseJsonCol<string[]>(r.tags, []),
    }));
  });
}

export async function getMaterial(id: string): Promise<Material | null> {
  const rows = await guardRead("getMaterial", () =>
    sql<Row>`select * from ms_materials where id = ${id}`);
  return rows[0] ? toMaterial(rows[0]) : null;
}

// D1 单条语句最多 100 个绑定参数，选题引用的素材可能更多，所以按 90 个一批查再拼起来
export async function getMaterials(ids: string[]): Promise<Material[]> {
  if (ids.length === 0) return [];
  const out: Material[] = [];
  for (let i = 0; i < ids.length; i += 90) {
    const batch = ids.slice(i, i + 90);
    const rows = await guardRead("getMaterials", () =>
      sql<Row>`select * from ms_materials where id in ${sql.list(batch)}`);
    out.push(...rows.map(toMaterial));
  }
  return out;
}

export async function updateMaterial(
  id: string,
  patch: Partial<Pick<Material, "status" | "pillar">>,
): Promise<Material | null> {
  const rows = await guardWrite("updateMaterial", () => sql<Row>`
    update ms_materials set ${sql(patch as Record<string, unknown>)} where id = ${id} returning *`);
  return rows[0] ? toMaterial(rows[0]) : null;
}

// 新建素材（手动录入 / RSS 采集共用）。dedupe_key 冲突时返回 null 表示已存在。
export async function createMaterial(data: {
  source: MaterialSource;
  source_id?: string | null;
  dedupe_key?: string | null;
  pillar?: Pillar | null;
  title?: string | null;
  title_en?: string | null;
  url?: string | null;
  summary?: string | null;
  content?: string | null;
  category?: string | null;
  tags?: string[];
  published_at?: string | null;
  raw?: unknown;
}): Promise<Material | null> {
  const rows = await guardWrite("createMaterial", () => sql<Row>`
    insert into ms_materials ${sql({
      source: data.source,
      source_id: data.source_id ?? null,
      dedupe_key: data.dedupe_key ?? null,
      pillar: data.pillar ?? null,
      title: data.title ?? null,
      title_en: data.title_en ?? null,
      url: data.url ?? null,
      summary: data.summary ?? null,
      content: data.content ?? null,
      category: data.category ?? null,
      tags: sql.json(data.tags ?? []),
      published_at: data.published_at ?? null,
      status: "new",
      raw: data.raw ? sql.json(data.raw) : null,
    })}
    on conflict (dedupe_key) do nothing
    returning *`);
  return rows[0] ? toMaterial(rows[0]) : null;
}

// ===== 选题 =====
export async function listTopics(f: { status?: TopicStatus; pillar?: Pillar } = {}): Promise<Topic[]> {
  return guardRead("listTopics", async () => {
    const conds = [];
    if (f.status) conds.push(sql`status = ${f.status}`);
    if (f.pillar) conds.push(sql`pillar = ${f.pillar}`);
    let where = sql``;
    conds.forEach((c, i) => {
      where = i === 0 ? sql`where ${c}` : sql`${where} and ${c}`;
    });
    const rows = await sql<Row>`select * from ms_topics ${where} order by priority desc, updated_at desc`;
    return rows.map(toTopic);
  });
}

export async function getTopic(id: string): Promise<Topic | null> {
  const rows = await guardRead("getTopic", () =>
    sql<Row>`select * from ms_topics where id = ${id}`);
  return rows[0] ? toTopic(rows[0]) : null;
}

export async function createTopic(data: {
  title?: string;
  angle?: string;
  pillar?: Pillar | null;
  persona?: string;
  material_ids?: string[];
  research?: unknown;
  status?: TopicStatus;
  notes?: string;
}): Promise<Topic> {
  const rows = await guardWrite("createTopic", () => sql<Row>`
    insert into ms_topics ${sql({
      title: data.title ?? null,
      angle: data.angle ?? null,
      pillar: data.pillar ?? null,
      persona: data.persona ?? null,
      material_ids: sql.json(data.material_ids ?? []),
      research: data.research ? sql.json(data.research) : null,
      status: data.status ?? "idea",
      notes: data.notes ?? null,
    })}
    returning *`);
  return toTopic(rows[0]);
}

export async function updateTopic(
  id: string,
  patch: Record<string, unknown>,
): Promise<Topic | null> {
  const clean = { ...patch };
  // 结构化列在 D1 里是 TEXT，写进去前统一转 JSON 文本
  if ("research" in clean && clean.research != null) clean.research = sql.json(clean.research);
  if ("material_ids" in clean && clean.material_ids != null) {
    clean.material_ids = sql.json(clean.material_ids);
  }
  const rows = await guardWrite("updateTopic", () => sql<Row>`
    update ms_topics set ${sql(clean)} where id = ${id} returning *`);
  return rows[0] ? toTopic(rows[0]) : null;
}

// 服务端追加素材到选题：去重、保序，避免客户端用陈旧数组整体覆盖导致丢引用。
// Postgres 版是一条 SQL 里用数组算子原子完成的；D1 没有数组类型，改成读-合并-写。
// 这个站是单用户工作台，不存在两个人同时给同一选题加素材的并发场景，读写间隙可接受。
export async function appendTopicMaterials(id: string, materialIds: string[]): Promise<Topic | null> {
  if (materialIds.length === 0) return getTopic(id);
  const current = await getTopic(id);
  if (!current) return null;
  const merged = [...current.material_ids];
  for (const mid of materialIds) if (!merged.includes(mid)) merged.push(mid);
  const rows = await guardWrite("appendTopicMaterials", () => sql<Row>`
    update ms_topics set material_ids = ${sql.json(merged)} where id = ${id} returning *`);
  return rows[0] ? toTopic(rows[0]) : null;
}

// 删除选题（其下稿件一并删除）。
// Postgres 靠外键 on delete cascade；D1 也声明了外键，但显式先删稿件更保险，
// 免得哪天 PRAGMA foreign_keys 没开就留下一堆孤儿稿。
export async function deleteTopic(id: string): Promise<boolean> {
  await guardWrite("deleteTopicDrafts", () => sql`delete from ms_drafts where topic_id = ${id}`);
  const rows = await guardWrite("deleteTopic", () =>
    sql<{ id: string }>`delete from ms_topics where id = ${id} returning id`);
  return rows.length > 0;
}

// ===== 稿件 =====
// 稿件 + 所属选题标题与板块（列表页展示与生成板块筛选选项用）
export type DraftWithTopic = Draft & { topic_title: string | null; pillar: string | null };

export async function listDrafts(
  f: { status?: DraftStatus; platform?: Platform; pillar?: Pillar; topic_id?: string } = {},
): Promise<DraftWithTopic[]> {
  return guardRead("listDrafts", async () => {
    const conds = [];
    if (f.status) conds.push(sql`d.status = ${f.status}`);
    if (f.platform) conds.push(sql`d.platform = ${f.platform}`);
    if (f.topic_id) conds.push(sql`d.topic_id = ${f.topic_id}`);
    if (f.pillar) conds.push(sql`t.pillar = ${f.pillar}`);
    let where = sql``;
    conds.forEach((c, i) => {
      where = i === 0 ? sql`where ${c}` : sql`${where} and ${c}`;
    });
    const rows = await sql<Row>`
      select d.*, t.title as topic_title, t.pillar as pillar from ms_drafts d
      left join ms_topics t on t.id = d.topic_id
      ${where}
      order by d.updated_at desc`;
    return rows.map((r) => toDraft<DraftWithTopic>(r));
  });
}

export async function getDraft(id: string): Promise<Draft | null> {
  const rows = await guardRead("getDraft", () =>
    sql<Row>`select * from ms_drafts where id = ${id}`);
  return rows[0] ? toDraft<Draft>(rows[0]) : null;
}

export async function createDraft(data: {
  topic_id?: string | null;
  platform: Platform;
  title?: string | null;
  content?: string | null;
  meta?: unknown;
  generator?: string;
  status?: DraftStatus;
}): Promise<Draft> {
  const rows = await guardWrite("createDraft", () => sql<Row>`
    insert into ms_drafts ${sql({
      topic_id: data.topic_id ?? null,
      platform: data.platform,
      title: data.title ?? null,
      content: data.content ?? null,
      meta: data.meta ? sql.json(data.meta) : null,
      generator: data.generator ?? "api",
      status: data.status ?? "draft",
    })}
    returning *`);
  return toDraft<Draft>(rows[0]);
}

export async function updateDraft(
  id: string,
  patch: Record<string, unknown>,
): Promise<Draft | null> {
  const clean = { ...patch };
  if ("meta" in clean && clean.meta != null) clean.meta = sql.json(clean.meta);
  const rows = await guardWrite("updateDraft", () => sql<Row>`
    update ms_drafts set ${sql(clean)} where id = ${id} returning *`);
  return rows[0] ? toDraft<Draft>(rows[0]) : null;
}

// 删稿连带删稿件级缓存：封面 base64（cover_image:<draftId>）与小红书高亮中转缓存
// （xhs_assist:<draftId>）都存在 ms_sync_state 里（不进 ms_drafts），只删稿会留下
// 永远没人回收的孤儿行（封面每张 2-3 MB 是大头）。缓存删除失败不阻断删稿——
// 稿件已经没了，等 cron 的 purgeSyncCache 按孤儿规则兜底。
export async function deleteDraft(id: string): Promise<boolean> {
  const rows = await guardWrite("deleteDraft", () =>
    sql<{ id: string }>`delete from ms_drafts where id = ${id} returning id`);
  if (rows.length === 0) return false;
  await guardWrite("deleteDraftCaches", () =>
    sql`delete from ms_sync_state
        where key in ${sql.list([`cover_image:${id}`, `xhs_assist:${id}`])}`,
  ).catch(() => {});
  return true;
}

// ===== 发布闭环 =====
// 稿件发布后：把选题引用的素材批量推到「已用」，让素材状态自动跟上。
// material_ids 是 JSON 数组文本，用 json_each 展开成行再做 in 子查询。
export async function markTopicMaterialsUsed(topicId: string): Promise<number> {
  const rows = await guardWrite("markTopicMaterialsUsed", () => sql<{ id: string }>`
    update ms_materials set status = 'used'
    where status in ('new', 'shortlisted')
      and id in (
        select je.value from ms_topics t, json_each(t.material_ids) je where t.id = ${topicId}
      )
    returning id`);
  return rows.length;
}

// 选题下全部稿件都已发布时，把选题推到「完成」。返回是否发生了推进。
export async function maybeCompleteTopic(topicId: string): Promise<boolean> {
  const rows = await guardWrite("maybeCompleteTopic", () => sql<{ id: string }>`
    update ms_topics set status = 'done'
    where id = ${topicId}
      and status <> 'done'
      and exists (select 1 from ms_drafts where topic_id = ${topicId})
      and not exists (select 1 from ms_drafts where topic_id = ${topicId} and status <> 'published')
    returning id`);
  return rows.length > 0;
}

// 手动回填过互动数据的已发布稿件，按加权互动分倒序（views 计 1、likes 计 10、reposts 计 15、comments 计 20）
export interface TopDraftRow {
  id: string;
  platform: string;
  title: string | null;
  published_url: string | null;
  published_at: string | null;
  meta: unknown;
  pillar: string | null;
  topic_title: string | null;
  angle: string | null;
  engagement: number;
}
export async function topPerformingDrafts(limit = 5): Promise<TopDraftRow[]> {
  return guardRead("topPerformingDrafts", async () => {
    // Postgres 版用 meta#>>'{stats,views}' 取值，D1 换成 json_extract 的路径写法
    const rows = await sql<Row>`
      select d.id, d.platform, d.title, d.published_url, d.published_at, d.meta,
        t.pillar, t.title as topic_title, t.angle,
        (coalesce(json_extract(d.meta, '$.stats.views'), 0)
          + coalesce(json_extract(d.meta, '$.stats.likes'), 0) * 10
          + coalesce(json_extract(d.meta, '$.stats.reposts'), 0) * 15
          + coalesce(json_extract(d.meta, '$.stats.comments'), 0) * 20) as engagement
      from ms_drafts d
      left join ms_topics t on t.id = d.topic_id
      where d.status = 'published' and json_extract(d.meta, '$.stats') is not null
      order by engagement desc
      limit ${limit}`;
    return rows.map((r) => ({
      ...(r as unknown as TopDraftRow),
      meta: parseJsonCol<unknown>(r.meta, null),
      engagement: Number(r.engagement ?? 0),
    }));
  });
}

// ===== 通用 KV（ms_sync_state）=====
// 这张表是全站唯一的键值存储，当前已占用的 key 空间（新增用途前先过一遍这份清单）：
//   rss              RSS 采集运行状态（lib/ingest.ts）
//   cleanup          全局清理时间戳 { lastPrunedAt }（lib/cleanup.ts）
//   app_config       全站配置单例（lib/config.ts）
//   prompt_overrides 提示词覆盖单例（lib/prompt-store.ts）
//   cover_image:<draftId>  封面图 base64 缓存（app/api/cover/image），删稿连带删 + cron TTL 回收
//   xhs_assist:<draftId>   小红书高亮/emoji 中转缓存（app/api/drafts/[id]/xhs-highlight），同上
// 约定：稿件级「缓存型」key 必须同时接入 deleteDraft 的连带删除和 purgeSyncCache 的 cron 兜底，
// 只写不清的 key 会让这张表无限膨胀。
export async function getSyncState(key: string): Promise<unknown> {
  const rows = await guardRead("getSyncState", () =>
    sql<{ value: unknown }>`select value from ms_sync_state where key = ${key}`);
  const v = rows[0]?.value ?? null;
  // D1 里 value 是 TEXT，读回来就是 JSON 字符串，解析一次即可；
  // 解析不出来就按裸字符串返回（历史数据兜底）
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}

// setSyncState 是热路径写入点（小红书缓存、封面落库、采集位点都走它）
export async function setSyncState(key: string, value: unknown): Promise<void> {
  await guardWrite("setSyncState", () => sql`
    insert into ms_sync_state (key, value) values (${key}, ${sql.json(value)})
    on conflict (key) do update set value = excluded.value`);
}

// 清理过期的未处理素材：防止过时资讯污染选题池。
// 只作用于「时效性来源」（rss，见 lib/cleanup.ts 的 TIMELY_SOURCES）——
// manual 是用户手动录入的存量，永不过期，绝不能清。
// 超保留期直接物理删除（2026-07-18 用户拍板：不要「先标已过期、再等宽限期真删」的两段式，
// 时效性新闻过期即失去价值，彻底消失即可）。
// 只动「status 为 new/ignored 且未被任何选题引用」的条目，保护已入选(shortlisted)/已用(used)的素材；
// ignored 是用户明确划掉的，一并纳入清理，否则永久占位。
// 时效判定用 created_at（素材在系统里存在多久 = 用户有没有机会 review），
// 不能用 published_at：采集窗口可能大于保留期，若按发布时间会把刚采进来的
// 旧发布日期条目当场清掉。整型保护交由调用方，这里再兜一层 floor。
export async function pruneStaleMaterials(
  source: string,
  retentionDays: number,
): Promise<number> {
  const days = Math.max(1, Math.floor(retentionDays));
  const cutoff = isoDaysAgo(days);
  // SQLite 的 delete 不支持表别名，条件里直接用列名
  const rows = await guardWrite("pruneStaleMaterials", () => sql<{ id: string }>`
    delete from ms_materials
    where source = ${source}
      and status in ('new', 'ignored')
      and created_at < ${cutoff}
      and id not in (
        select je.value from ms_topics t, json_each(t.material_ids) je
      )
    returning id`);
  return rows.length;
}

// 回收稿件级 KV 缓存（cover_image:* / xhs_assist:* 这类 <prefix>:<draftId> 键）。
// 封面 base64 每张 2-3 MB，是全库唯一的体积大头。两种回收对象：
//   1. 孤儿——对应稿件已删除，缓存永远没人再读（deleteDraft 已做连带删除，这里兜历史遗留和删除失败）
//   2. 超期——updatedAt 超过 retentionDays 天。稿件本身留着，只回收缓存，需要时可重新生成
// updatedAt 缺失或格式不认识时按「不超期」处理（保守），只有孤儿判定能删它。
// 下限 1 天：这些缓存是可再生的临时副本（见 lib/cleanup.ts），不像素材那样需要
// 「别手滑删了捞不回来」的宽限期。
export async function purgeSyncCache(prefix: string, retentionDays = 1): Promise<number> {
  const days = Math.max(1, Math.floor(retentionDays));
  const cutoff = isoDaysAgo(days);
  const like = `${prefix}:%`;
  const replaceFrom = `${prefix}:`;
  // Postgres 版用 value->>'updatedAt' + 正则判形，D1 换成 json_extract；
  // 格式判形改用 like 'ISO 前缀'，SQLite 没有正则算子
  const rows = await guardWrite("purgeSyncCache", () => sql<{ key: string }>`
    delete from ms_sync_state
    where key like ${like}
      and (
        not exists (
          select 1 from ms_drafts d where d.id = replace(key, ${replaceFrom}, '')
        )
        or (
          json_extract(value, '$.updatedAt') like '____-__-__T%'
          and json_extract(value, '$.updatedAt') < ${cutoff}
        )
      )
    returning key`);
  return rows.length;
}

// ===== 仪表盘统计 =====
export async function dashboardCounts() {
  return guardRead("dashboardCounts", async () => {
    const [materials, topics, drafts] = await Promise.all([
      sql<{ status: string; count: number }>`select status, count(*) as count from ms_materials group by status`,
      sql<{ status: string; count: number }>`select status, count(*) as count from ms_topics group by status`,
      sql<{ status: string; count: number }>`select status, count(*) as count from ms_drafts group by status`,
    ]);
    const bySource = await sql<{ source: string; count: number }>`select source, count(*) as count from ms_materials group by source`;
    const todayNew = await sql<{ count: number }>`
      select count(*) as count from ms_materials
      where source = 'rss' and created_at >= ${isoHoursAgo(24)}`;
    const total = await sql<{ count: number }>`select count(*) as count from ms_materials`;
    return {
      materials: Object.fromEntries(materials.map((r) => [r.status, Number(r.count)])),
      topics: Object.fromEntries(topics.map((r) => [r.status, Number(r.count)])),
      drafts: Object.fromEntries(drafts.map((r) => [r.status, Number(r.count)])),
      bySource: Object.fromEntries(bySource.map((r) => [r.source, Number(r.count)])),
      todayRss: Number(todayNew[0]?.count ?? 0),
      totalMaterials: Number(total[0]?.count ?? 0),
    };
  });
}
