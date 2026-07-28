import { sql } from "./db";
import { getSyncState, setSyncState, guardRead, guardWrite } from "./queries";
import { runCleanup, type CleanupResult } from "./cleanup";
import { resolveRssFeeds, resolveRssRetentionDays, resolveDailySummary } from "./config";
import { fetchFeed } from "./rss";
import { translateNewMaterials, type TranslateResult } from "./translate";
import { sendEmail, escapeHtml } from "./notify";

const RSS_SYNC_KEY = "rss";

// ===== RSS 采集 =====

export interface RssFeedResult {
  url: string;
  label?: string;
  fetched: number;
  inserted: number;
  error?: string; // 该源本次的错误（按 feed 隔离）
}

export interface RssIngestResult {
  fetched: number;
  inserted: number;
  feeds: RssFeedResult[];
}

// 每源单轮入库上限：有的 feed 是全量归档（OpenAI 官方一次给 1000+ 条历史文章），
// 不设上限会把选题池灌满陈年旧文。正常增量场景一天到不了 20 条，不影响日常采集。
const RSS_MAX_ITEMS_PER_FEED = 20;

// 一次批量 upsert 一个源的条目，返回实际入库数（去重后）。
// 为什么批量：替代原来每条一次 INSERT 的几十次网络往返，一个源一次多行 upsert 写完。
// dedupe_key 用链接：同一篇文章跨天重复出现在 feed 里也只入一次；源内先按 key 去重，
// 避免同一批里出现重复链接（on conflict do nothing 对批内重复安全，去重只为计数准确）。
async function insertRssItems(
  feed: { url: string; label?: string; pillar: string },
  parsed: { title: string | null },
  items: { title: string; link: string; summary: string; publishedAt: string | null }[],
): Promise<number> {
  const seen = new Set<string>();
  const rows: {
    source: string;
    source_id: string;
    dedupe_key: string;
    pillar: string;
    title: string;
    title_en: string | null;
    url: string;
    summary: string | null;
    content: string | null;
    category: string | null;
    tags: string[];
    published_at: string | null;
    status: string;
    raw: string;
  }[] = [];
  for (const item of items) {
    const dedupe_key = `rss:${item.link}`;
    if (seen.has(dedupe_key)) continue;
    seen.add(dedupe_key);
    rows.push({
      source: "rss",
      source_id: item.link,
      dedupe_key,
      pillar: feed.pillar,
      title: item.title,
      title_en: null,
      url: item.link,
      summary: item.summary || null,
      content: null,
      category: feed.label ?? parsed.title ?? null,
      tags: [] as string[],
      published_at: item.publishedAt,
      status: "new",
      raw: JSON.stringify(item),
    });
  }
  if (rows.length === 0) return 0;
  const cols = [
    "source", "source_id", "dedupe_key", "pillar", "title", "title_en",
    "url", "summary", "content", "category", "tags",
    "published_at", "status", "raw",
  ] as const;
  // guardWrite 包裹：守住硬约定 #4（pooler 挂死自愈），与 createMaterial 同一层保护
  const insertedRows = await guardWrite("ingestRss", () => sql`
    insert into ms_materials ${sql(rows, ...cols)}
    on conflict (dedupe_key) do nothing
    returning id`);
  return insertedRows.length;
}

// 采集 RSS：读配置里的订阅源，**并行抓取**（自报 UA），每源一次批量 upsert 幂等入库。
// 并行安全性：各订阅源是不同网站，各打各的、无相互限流，可放心并发抓取。
// 抓取并行、DB 写按源串行（每源一次批量 upsert）：既拿到并行加速，又只占一个写连接，
// 不把 transaction pooler 连接数打爆（硬约定 #4）。
// 错误按 feed 隔离：某源抓取失败（allSettled 的 rejected）或落库失败只标记该源，不影响其他源。
// 采集侧只收「保留期内」的条目（发布时间超过 rssRetentionDays 的直接跳过）——
// 清理侧按 created_at 算过期，归档型 feed 的陈年旧文若放进来要占满收件箱一整个保留期。
export async function ingestRss(): Promise<RssIngestResult> {
  const feeds = await resolveRssFeeds();
  const retentionDays = await resolveRssRetentionDays();
  const sinceMs = Date.now() - retentionDays * 86400_000;

  // 第一步：并行抓取所有源。allSettled 保住「一个源挂了不影响其他源」的隔离语义。
  const fetchOutcomes = await Promise.allSettled(feeds.map((feed) => fetchFeed(feed.url)));

  // 第二步：按源串行落库（每源一次批量写），保住 pooler 连接数红线与逐源 inserted 计数。
  const results: RssFeedResult[] = [];
  for (let i = 0; i < feeds.length; i++) {
    const feed = feeds[i];
    const outcome = fetchOutcomes[i];
    const r: RssFeedResult = { url: feed.url, label: feed.label, fetched: 0, inserted: 0 };
    if (outcome.status === "rejected") {
      r.error = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      results.push(r);
      continue;
    }
    const parsed = outcome.value;
    // 无发布时间的条目放行（靠每源上限兜底），有时间的必须在保留期内
    const items = parsed.items
      .filter((it) => !it.publishedAt || Date.parse(it.publishedAt) >= sinceMs)
      .slice(0, RSS_MAX_ITEMS_PER_FEED);
    r.fetched = items.length;
    try {
      r.inserted = await insertRssItems(feed, parsed, items);
    } catch (e) {
      r.error = e instanceof Error ? e.message : String(e);
    }
    results.push(r);
  }

  const fetched = results.reduce((s, r) => s + r.fetched, 0);
  const inserted = results.reduce((s, r) => s + r.inserted, 0);
  const failed = results.filter((r) => r.error);
  const anySuccess = results.some((r) => !r.error);

  const now = new Date().toISOString();
  const prev =
    ((await getSyncState(RSS_SYNC_KEY).catch(() => null)) as Record<string, unknown> | null) ?? {};
  await setSyncState(RSS_SYNC_KEY, {
    lastRunAt: now,
    // 没配置源也算「成功跑完」；全部源失败才不刷新成功时间
    lastSuccessAt: feeds.length === 0 || anySuccess ? now : prev.lastSuccessAt ?? null,
    lastError: failed.length
      ? failed.map((r) => `${r.label ?? r.url}: ${r.error}`).join("；")
      : null,
    lastErrorAt: failed.length ? now : prev.lastErrorAt ?? null,
    lastFetched: fetched,
    lastInserted: inserted,
  });

  return { fetched, inserted, feeds: results };
}

// ===== 每日摘要邮件 =====

// 若开启 dailySummary 且当天有新增素材，发采集摘要邮件。
// 返回 sent 与未发送原因；发送失败也不抛（sendEmail 内部静默）。
async function sendDailySummary(rssNew: number): Promise<{ sent: boolean; reason?: string }> {
  const enabled = await resolveDailySummary();
  if (!enabled) return { sent: false, reason: "每日摘要未开启" };
  if (rssNew <= 0) return { sent: false, reason: "今日无新增素材" };

  // 今日新增里按入库时间取前 10 条
  const top = await guardRead("dailySummaryTop", () => sql<
    { title: string | null; summary: string | null }[]
  >`
    select title, summary from ms_materials
    where source = 'rss' and created_at >= now() - interval '24 hours'
    order by created_at desc
    limit 10`);
  // 当前待发稿件数（未发布的全部稿件）
  const pending = await guardRead("dailySummaryPending", () => sql<{ count: string }[]>`
    select count(*)::text from ms_drafts where status <> 'published'`);
  const pendingCount = Number(pending[0]?.count ?? 0);

  const topHtml = top
    .map(
      (t) =>
        `<li style="margin-bottom:8px"><strong>${escapeHtml(t.title ?? "（无标题）")}</strong>` +
        (t.summary
          ? `<br/><span style="color:#666">${escapeHtml(t.summary.slice(0, 120))}${t.summary.length > 120 ? "…" : ""}</span>`
          : "") +
        `</li>`,
    )
    .join("");

  const siteUrl = process.env.SITE_URL || "http://localhost:3000";
  const html = `
    <div style="font-family:system-ui,sans-serif;line-height:1.6;color:#222">
      <h2 style="margin:0 0 12px">今日采集摘要</h2>
      <p>RSS 订阅新增素材 <strong>${rssNew}</strong> 条。</p>
      ${top.length ? `<p style="margin-bottom:4px"><strong>最新 ${top.length} 条：</strong></p><ul style="padding-left:20px;margin-top:4px">${topHtml}</ul>` : ""}
      <p>当前待发稿件：<strong>${pendingCount}</strong> 篇。</p>
      <p><a href="${siteUrl}/inbox" style="color:#2563eb">→ 打开素材收件箱处理</a></p>
    </div>`;

  const ok = await sendEmail({
    subject: `Media Studio 每日采集：新增 ${rssNew} 条素材`,
    html,
  });
  return ok ? { sent: true } : { sent: false, reason: "邮件发送失败（详见服务端日志）" };
}

// ===== 每日总任务编排（cron GET 调用）=====

export interface DailyIngestResult {
  ok: boolean; // RSS 采集这一步没炸才算 ok（feed 级局部失败不算炸）
  rss: RssIngestResult | { error: string };
  translate: TranslateResult | { error: string };
  cleanup: CleanupResult | { error: string };
  summary: { sent: boolean; reason?: string };
}

// 每日流程：RSS 采集 → 英文素材翻译 → 清理 → 摘要邮件。
// 清理排在采集之后：刚采进来的条目 created_at 是当下，不会被自己这轮清掉。
// 各步错误隔离：任何一步失败都不阻断后续步骤，结果汇总在返回值里。
export async function runDailyIngest(): Promise<DailyIngestResult> {
  let rss: DailyIngestResult["rss"];
  try {
    rss = await ingestRss();
  } catch (e) {
    rss = { error: e instanceof Error ? e.message : String(e) };
  }

  // 翻译排在采集之后：一轮把当天所有新进英文素材翻完；失败不影响采集结果
  let translate: DailyIngestResult["translate"];
  try {
    translate = await translateNewMaterials();
  } catch (e) {
    translate = { error: e instanceof Error ? e.message : String(e) };
  }

  let cleanup: DailyIngestResult["cleanup"];
  try {
    cleanup = await runCleanup();
  } catch (e) {
    cleanup = { error: e instanceof Error ? e.message : String(e) };
  }

  let summary: DailyIngestResult["summary"];
  try {
    const rssNew = "inserted" in rss ? rss.inserted : 0;
    summary = await sendDailySummary(rssNew);
  } catch (e) {
    summary = { sent: false, reason: e instanceof Error ? e.message : String(e) };
  }

  return {
    ok: !("error" in rss),
    rss,
    translate,
    cleanup,
    summary,
  };
}
