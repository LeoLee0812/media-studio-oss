import {
  getSyncState,
  setSyncState,
  pruneStaleMaterials,
  purgeSyncCache,
} from "./queries";
import { sql } from "./db";
import { resolveRssRetentionDays } from "./config";

// 纳入清理的「时效性来源」：这些是每天流进来的活水，过时即失去选题价值。
// manual 是用户手动录入的存量，是资产不是流水，永不清理——
// 往这个数组里加来源前先想清楚它是流水还是资产。
export const TIMELY_SOURCES = ["rss"] as const;

// 封面图保留期（天）：1 天。封面是全库唯一的体积大头（29 MB 封面 vs 其余字段共 2.6 MB），
// 一张 2-3 MB，比一条素材重上千倍。
// 敢设这么短，是因为 DB 里这份 base64 只是「稿件页打开时回显历史封面」的便利副本——
// 封面生成后前端已经裁剪并存进本地绑定文件夹（lib/cover-client.ts），成品在本地，
// 库里的副本只需覆盖「刚生成完、还在同一轮编辑里回看」这个窗口，想不到就重新生成一张。
// 稳态因此约等于「当天生成的封面数」（几 MB），而不是随时间线性上涨。
export const COVER_RETENTION_DAYS = 1;

// 小红书高亮中转缓存保留期（天）：30 天。单条只有几百字节，留久一点让「隔很久再复制
// 同一篇稿」也能秒贴；孤儿（稿件已删）则由 purgeSyncCache 的孤儿规则当天回收。
export const XHS_ASSIST_RETENTION_DAYS = 30;

export interface CleanupResult {
  pruned: Record<string, number>; // 按来源：本次直接删除的超期素材条数
  coversPurged: number; // 本次回收的封面图数（孤儿 + 超期）
  xhsPurged: number; // 本次回收的小红书中转缓存数（孤儿 + 超期）
}

// 每日清理（cron 调用，也可从设置页手动触发）。三件事：
//   1. 各时效性来源按各自保留期直接删除超期未处理素材（2026-07-18 起不再有
//      「已过期」软删中转态——时效性新闻过期即失去价值，超期一步删干净）
//   2. 回收封面图缓存（孤儿 + 超期），这是体积大头
//   3. 回收小红书高亮中转缓存（孤儿 + 超期），防止 ms_sync_state 只增不减
// 清理时间落在 sync_state 的独立键 "cleanup" 上（{ lastPrunedAt }，设置页「上次清理」读它）——
// 此前误写在采集源的 sync_state 键上，会与采集状态互相覆盖。
export const CLEANUP_SYNC_KEY = "cleanup";

export async function runCleanup(): Promise<CleanupResult> {
  const retention = await resolveRetentionDays();

  const pruned: Record<string, number> = {};
  for (const source of TIMELY_SOURCES) {
    pruned[source] = await pruneStaleMaterials(source, retention[source]);
  }

  const coversPurged = await purgeSyncCache("cover_image", COVER_RETENTION_DAYS);
  const xhsPurged = await purgeSyncCache("xhs_assist", XHS_ASSIST_RETENTION_DAYS);

  const now = new Date().toISOString();
  const state =
    ((await getSyncState(CLEANUP_SYNC_KEY).catch(() => null)) as Record<string, unknown>) ?? {};
  await setSyncState(CLEANUP_SYNC_KEY, { ...state, lastPrunedAt: now }).catch(() => {});

  return { pruned, coversPurged, xhsPurged };
}

// 各时效性来源的保留天数（DB 配置优先，env/默认兜底）
async function resolveRetentionDays(): Promise<Record<string, number>> {
  const rssDays = await resolveRssRetentionDays();
  return { rss: rssDays };
}

export interface CleanupDryRunLine {
  label: string;
  count: number;
  extra?: string;
}

// dry-run：用与 runCleanup 完全相同的判定条件与常量数一遍，但不写库。
// 收在这里（而不是 scripts/cleanup.ts 里手写 SQL）是为了保证口径永不漂移——
// 此前脚本里硬编码过 30 天真删窗口，与 PURGE_DAYS=2 对不上，dry-run 数字失真。
export async function dryRunCleanup(): Promise<CleanupDryRunLine[]> {
  const retention = await resolveRetentionDays();
  const lines: CleanupDryRunLine[] = [];

  for (const source of TIMELY_SOURCES) {
    const [row] = await sql<{ n: string }[]>`
      select count(*)::text as n from ms_materials m
      where m.source = ${source}
        and m.status in ('new', 'ignored')
        and m.created_at < now() - make_interval(days => ${retention[source]})
        and not exists (select 1 from ms_topics t where m.id = any(t.material_ids))`;
    lines.push({ label: `${source} 超期直接删除（保留期 ${retention[source]} 天）`, count: Number(row.n) });
  }

  for (const { prefix, days, label } of [
    { prefix: "cover_image", days: COVER_RETENTION_DAYS, label: "封面图回收" },
    { prefix: "xhs_assist", days: XHS_ASSIST_RETENTION_DAYS, label: "小红书缓存回收" },
  ]) {
    const [row] = await sql<{ n: string; sz: string }[]>`
      select count(*)::text as n,
             pg_size_pretty(coalesce(sum(pg_column_size(s.value)), 0)::bigint) as sz
      from ms_sync_state s
      where s.key like ${`${prefix}:%`}
        and (
          not exists (
            select 1 from ms_drafts d where d.id::text = replace(s.key, ${`${prefix}:`}, '')
          )
          or (
            s.value->>'updatedAt' ~ '^\\d{4}-\\d{2}-\\d{2}T'
            and (s.value->>'updatedAt')::timestamptz < now() - make_interval(days => ${days})
          )
        )`;
    lines.push({ label: `${label}（保留期 ${days} 天）`, count: Number(row.n), extra: `约 ${row.sz}` });
  }

  return lines;
}
