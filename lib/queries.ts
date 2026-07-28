import { sql, resetSql } from "./db";
import type {
  Draft,
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
// serverless 里连接池可能持有已死的 socket，查询会无限挂起（表现为页面转圈
// 几十秒到几分钟，手机上就是「打不开」）。这里给查询加超时兜底：
// - 读操作：超时/断链 → 重建连接池 → 重试一次（读是幂等的，重试安全）
// - 写操作：超时 → 重建连接池 → 直接报错（不重试，避免重复写入）
const QUERY_TIMEOUT_MS = 5000;

class QueryTimeoutError extends Error {
  constructor(label: string) {
    super(`数据库查询超时：${label}`);
    this.name = "QueryTimeoutError";
  }
}

// postgres.js 的连接类错误码：这类错误说明连接已坏，重建池后重试有意义
function isConnectionError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return (
    code === "CONNECTION_CLOSED" ||
    code === "CONNECTION_ENDED" ||
    code === "CONNECTION_DESTROYED" ||
    code === "CONNECT_TIMEOUT"
  );
}

function withTimeout<T>(run: () => Promise<T>, ms: number, label: string): Promise<T> {
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

export async function guardRead<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await withTimeout(run, QUERY_TIMEOUT_MS, label);
  } catch (e) {
    if (!(e instanceof QueryTimeoutError) && !isConnectionError(e)) throw e;
    // 记录看门狗触发情况，便于在 Vercel 日志里观察挂起频率和原因
    console.warn(`[db-watchdog] ${label} 首次尝试失败(${(e as Error).name}: ${(e as Error).message})，重建连接池后重试`);
    resetSql();
    return withTimeout(run, QUERY_TIMEOUT_MS, label);
  }
}

export async function guardWrite<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await withTimeout(run, QUERY_TIMEOUT_MS * 2, label);
  } catch (e) {
    if (e instanceof QueryTimeoutError || isConnectionError(e)) resetSql();
    throw e;
  }
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
      const like = `%${f.q}%`;
      conds.push(sql`(title ilike ${like} or summary ilike ${like} or content ilike ${like})`);
    }
    let where = sql``;
    conds.forEach((c, i) => {
      where = i === 0 ? sql`where ${c}` : sql`${where} and ${c}`;
    });
    const limit = f.limit ?? 200;
    const rows = await sql<Material[]>`
      select * from ms_materials ${where}
      order by created_at desc
      limit ${limit}`;
    return rows;
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
  return guardRead("listMaterialsLite", () => sql<MaterialCard[]>`
    select id, source, title, title_en, summary, url, pillar, tags, status, created_at, published_at
    from ms_materials
    order by created_at desc
    limit ${limit}`);
}

export async function getMaterial(id: string): Promise<Material | null> {
  const rows = await guardRead("getMaterial", () =>
    sql<Material[]>`select * from ms_materials where id = ${id}`);
  return rows[0] ?? null;
}

export async function getMaterials(ids: string[]): Promise<Material[]> {
  if (ids.length === 0) return [];
  return guardRead("getMaterials", () =>
    sql<Material[]>`select * from ms_materials where id = any(${ids})`);
}

export async function updateMaterial(
  id: string,
  patch: Partial<Pick<Material, "status" | "pillar">>,
): Promise<Material | null> {
  const rows = await guardWrite("updateMaterial", () => sql<Material[]>`
    update ms_materials set ${sql(patch as Record<string, unknown>)} where id = ${id} returning *`);
  return rows[0] ?? null;
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
  const rows = await guardWrite("createMaterial", () => sql<Material[]>`
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
      tags: data.tags ?? [],
      published_at: data.published_at ?? null,
      status: "new",
      raw: data.raw ? JSON.stringify(data.raw) : null,
    })}
    on conflict (dedupe_key) do nothing
    returning *`);
  return rows[0] ?? null;
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
    return sql<Topic[]>`select * from ms_topics ${where} order by priority desc, updated_at desc`;
  });
}

export async function getTopic(id: string): Promise<Topic | null> {
  const rows = await guardRead("getTopic", () =>
    sql<Topic[]>`select * from ms_topics where id = ${id}`);
  return rows[0] ?? null;
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
  const rows = await guardWrite("createTopic", () => sql<Topic[]>`
    insert into ms_topics ${sql({
      title: data.title ?? null,
      angle: data.angle ?? null,
      pillar: data.pillar ?? null,
      persona: data.persona ?? null,
      material_ids: data.material_ids ?? [],
      research: data.research ? sql.json(data.research as never) : null,
      status: data.status ?? "idea",
      notes: data.notes ?? null,
    })}
    returning *`);
  return rows[0];
}

export async function updateTopic(
  id: string,
  patch: Record<string, unknown>,
): Promise<Topic | null> {
  const clean = { ...patch };
  if ("research" in clean && clean.research != null) {
    clean.research = sql.json(clean.research as never);
  }
  const rows = await guardWrite("updateTopic", () => sql<Topic[]>`
    update ms_topics set ${sql(clean)} where id = ${id} returning *`);
  return rows[0] ?? null;
}

// 服务端原子追加素材到选题：去重、保序，避免客户端用陈旧数组整体覆盖导致丢引用。
export async function appendTopicMaterials(id: string, materialIds: string[]): Promise<Topic | null> {
  if (materialIds.length === 0) return getTopic(id);
  const rows = await guardWrite("appendTopicMaterials", () => sql<Topic[]>`
    update ms_topics
    set material_ids = material_ids || array(
      select x from unnest(${materialIds}::uuid[]) as x where not (x = any(material_ids))
    )
    where id = ${id}
    returning *`);
  return rows[0] ?? null;
}

// 删除选题（其下稿件随外键 on delete cascade 一并删除）
export async function deleteTopic(id: string): Promise<boolean> {
  const rows = await guardWrite("deleteTopic", () =>
    sql<{ id: string }[]>`delete from ms_topics where id = ${id} returning id`);
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
    return sql<DraftWithTopic[]>`
      select d.*, t.title as topic_title, t.pillar as pillar from ms_drafts d
      left join ms_topics t on t.id = d.topic_id
      ${where}
      order by d.updated_at desc`;
  });
}

export async function getDraft(id: string): Promise<Draft | null> {
  const rows = await guardRead("getDraft", () =>
    sql<Draft[]>`select * from ms_drafts where id = ${id}`);
  return rows[0] ?? null;
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
  const rows = await guardWrite("createDraft", () => sql<Draft[]>`
    insert into ms_drafts ${sql({
      topic_id: data.topic_id ?? null,
      platform: data.platform,
      title: data.title ?? null,
      content: data.content ?? null,
      meta: data.meta ? sql.json(data.meta as never) : null,
      generator: data.generator ?? "api",
      status: data.status ?? "draft",
    })}
    returning *`);
  return rows[0];
}

export async function updateDraft(
  id: string,
  patch: Record<string, unknown>,
): Promise<Draft | null> {
  const clean = { ...patch };
  if ("meta" in clean && clean.meta != null) {
    clean.meta = sql.json(clean.meta as never);
  }
  const rows = await guardWrite("updateDraft", () => sql<Draft[]>`
    update ms_drafts set ${sql(clean)} where id = ${id} returning *`);
  return rows[0] ?? null;
}

// 删稿连带删稿件级缓存：封面 base64（cover_image:<draftId>）与小红书高亮中转缓存
// （xhs_assist:<draftId>）都存在 ms_sync_state 里（不进 ms_drafts），只删稿会留下
// 永远没人回收的孤儿行（封面每张 2-3 MB 是大头）。缓存删除失败不阻断删稿——
// 稿件已经没了，等 cron 的 purgeSyncCache 按孤儿规则兜底。
export async function deleteDraft(id: string): Promise<boolean> {
  const rows = await guardWrite("deleteDraft", () =>
    sql<{ id: string }[]>`delete from ms_drafts where id = ${id} returning id`);
  if (rows.length === 0) return false;
  await guardWrite("deleteDraftCaches", () =>
    sql`delete from ms_sync_state
        where key = any(${[`cover_image:${id}`, `xhs_assist:${id}`]}::text[])`,
  ).catch(() => {});
  return true;
}

// ===== 发布闭环 =====
// 稿件发布后：把选题引用的素材批量推到「已用」，让素材状态自动跟上
export async function markTopicMaterialsUsed(topicId: string): Promise<number> {
  const rows = await guardWrite("markTopicMaterialsUsed", () => sql<{ id: string }[]>`
    update ms_materials set status = 'used'
    where status in ('new', 'shortlisted')
      and id in (select unnest(material_ids) from ms_topics where id = ${topicId})
    returning id`);
  return rows.length;
}

// 选题下全部稿件都已发布时，把选题推到「完成」。返回是否发生了推进。
export async function maybeCompleteTopic(topicId: string): Promise<boolean> {
  const rows = await guardWrite("maybeCompleteTopic", () => sql<{ id: string }[]>`
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
  return guardRead("topPerformingDrafts", () => sql<TopDraftRow[]>`
    select d.id, d.platform, d.title, d.published_url, d.published_at, d.meta,
      t.pillar, t.title as topic_title, t.angle,
      (coalesce((d.meta#>>'{stats,views}')::numeric, 0)
        + coalesce((d.meta#>>'{stats,likes}')::numeric, 0) * 10
        + coalesce((d.meta#>>'{stats,reposts}')::numeric, 0) * 15
        + coalesce((d.meta#>>'{stats,comments}')::numeric, 0) * 20)::float as engagement
    from ms_drafts d
    left join ms_topics t on t.id = d.topic_id
    where d.status = 'published' and d.meta -> 'stats' is not null
    order by engagement desc
    limit ${limit}`);
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
    sql<{ value: unknown }[]>`select value from ms_sync_state where key = ${key}`);
  const v = rows[0]?.value ?? null;
  // 兼容历史双重编码：若读回是 JSON 字符串则再解析一次
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}

// setSyncState 是热路径写入点（小红书缓存、封面落库、采集位点都走它），
// 必须包 guardWrite 走连接自愈，否则撞上半死 socket 会顶格挂到网络层超时。
export async function setSyncState(key: string, value: unknown): Promise<void> {
  await guardWrite("setSyncState", () => sql`
    insert into ms_sync_state (key, value) values (${key}, ${sql.json(value as never)})
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
  const rows = await guardWrite("pruneStaleMaterials", () => sql<{ id: string }[]>`
    delete from ms_materials m
    where m.source = ${source}
      and m.status in ('new', 'ignored')
      and m.created_at < now() - make_interval(days => ${days})
      and not exists (
        select 1 from ms_topics t where m.id = any(t.material_ids)
      )
    returning m.id`);
  return rows.length;
}

// 回收稿件级 KV 缓存（cover_image:* / xhs_assist:* 这类 <prefix>:<draftId> 键）。
// 封面 base64 每张 2-3 MB，是全库唯一的体积大头——29 MB 封面 vs 其余所有字段加起来 2.6 MB。
// 两种回收对象：
//   1. 孤儿——对应稿件已删除，缓存永远没人再读（deleteDraft 已做连带删除，这里兜历史遗留和删除失败）
//   2. 超期——updatedAt 超过 retentionDays 天。稿件本身留着，只回收缓存，需要时可重新生成
// updatedAt 缺失或格式不认识时按「不超期」处理（保守），只有孤儿判定能删它。
// 下限 1 天：这些缓存是可再生的临时副本（见 lib/cleanup.ts），不像素材那样需要
// 「别手滑删了捞不回来」的宽限期。
export async function purgeSyncCache(prefix: string, retentionDays = 1): Promise<number> {
  const days = Math.max(1, Math.floor(retentionDays));
  const like = `${prefix}:%`;
  const replaceFrom = `${prefix}:`;
  const rows = await guardWrite("purgeSyncCache", () => sql<{ key: string }[]>`
    delete from ms_sync_state s
    where s.key like ${like}
      and (
        not exists (
          select 1 from ms_drafts d
          where d.id::text = replace(s.key, ${replaceFrom}, '')
        )
        or (
          s.value->>'updatedAt' ~ '^\\d{4}-\\d{2}-\\d{2}T'
          and (s.value->>'updatedAt')::timestamptz < now() - make_interval(days => ${days})
        )
      )
    returning s.key`);
  return rows.length;
}

// ===== 仪表盘统计 =====
export async function dashboardCounts() {
  return guardRead("dashboardCounts", async () => {
    const [materials, topics, drafts] = await Promise.all([
      sql<{ status: string; count: string }[]>`select status, count(*)::text from ms_materials group by status`,
      sql<{ status: string; count: string }[]>`select status, count(*)::text from ms_topics group by status`,
      sql<{ status: string; count: string }[]>`select status, count(*)::text from ms_drafts group by status`,
    ]);
    const bySource = await sql<{ source: string; count: string }[]>`select source, count(*)::text from ms_materials group by source`;
    const todayNew = await sql<{ count: string }[]>`
      select count(*)::text from ms_materials
      where source = 'rss' and created_at >= now() - interval '24 hours'`;
    const total = await sql<{ count: string }[]>`select count(*)::text from ms_materials`;
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
