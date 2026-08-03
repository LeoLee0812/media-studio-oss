import Link from "next/link";
import { cookies } from "next/headers";
import { AUTH_COOKIE, hasWorkspaceAccess } from "@/lib/auth";
import { Landing } from "@/components/Landing";
import {
  dashboardCounts,
  listTopics,
  listDrafts,
  topPerformingDrafts,
  getSyncState,
} from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SourceSyncButtons } from "@/components/SourceSyncButtons";
import { formatRelativeTime } from "@/lib/format";
import {
  SOURCE_LABELS,
  PLATFORM_LABELS,
  TOPIC_STATUS_LABELS,
  type MaterialSource,
  type Platform,
} from "@/lib/types";
import {
  FileText,
  Lightbulb,
  Layers,
  Send,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

export const dynamic = "force-dynamic";

// RSS 采集状态（字段可能缺失，全部按可选兼容）
interface RssSync {
  lastSuccessAt?: string;
  lastRunAt?: string;
  lastError?: string | null;
}

// 采集健康判定：超过 26 小时没有成功采集就算失联（Cron 每天一次，留 2 小时余量）
function isSyncStale(lastSuccessAt?: string): boolean {
  if (!lastSuccessAt) return true;
  const ts = new Date(lastSuccessAt).getTime();
  return !ts || Date.now() - ts > 26 * 3600 * 1000;
}

export default async function DashboardPage() {
  // "/" 是门禁开放的：未登录看落地页，登录了才查数据、渲染仪表盘
  const authed = await hasWorkspaceAccess((await cookies()).get(AUTH_COOKIE)?.value);
  if (!authed) return <Landing />;

  const [counts, drafting, pendingDrafts, topDrafts, syncRaw] = await Promise.all([
    dashboardCounts(),
    listTopics({ status: "drafting" }),
    listDrafts({ status: "draft" }),
    topPerformingDrafts(5),
    getSyncState("rss"),
  ]);

  const sync = (syncRaw ?? {}) as RssSync;
  const syncStale = isSyncStale(sync.lastSuccessAt);

  // 统计卡：整卡可点，跳到对应列表页
  const stat = (label: string, value: number, icon: React.ReactNode, href: string) => (
    <Link href={href} className="block">
      <Card className="transition-colors hover:bg-accent/50">
        <CardContent className="flex items-center gap-3 p-4">
          <div className="flex size-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
            {icon}
          </div>
          <div>
            <div className="text-2xl font-bold tabular-nums">{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">仪表盘</h1>
          <p className="text-sm text-muted-foreground">
            素材库 {counts.totalMaterials} 条 ·{" "}
            <Link href="/inbox" className="underline-offset-2 hover:text-foreground hover:underline">
              今日 RSS 新增 {counts.todayRss} 条
            </Link>
          </p>
        </div>
        <SourceSyncButtons />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stat("素材总数", counts.totalMaterials, <Layers className="size-5" />, "/inbox")}
        {stat("进行中选题", counts.topics.drafting ?? 0, <Lightbulb className="size-5" />, "/topics")}
        {stat("待发布稿件", counts.drafts.draft ?? 0, <FileText className="size-5" />, "/drafts?status=draft")}
        {stat("已发布", counts.drafts.published ?? 0, <Send className="size-5" />, "/drafts?status=published")}
      </div>

      {/* 采集健康：RSS 定时任务的最近运行情况 */}
      <div
        className={
          "flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-xs " +
          (syncStale ? "border-destructive/50 bg-destructive/10 text-destructive" : "text-muted-foreground")
        }
      >
        {syncStale ? (
          <span className="flex items-center gap-1 font-medium">
            <AlertTriangle className="size-3.5" />
            {sync.lastSuccessAt ? "RSS 已超 26 小时未成功采集" : "RSS 暂无成功采集记录"}
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <CheckCircle2 className="size-3.5" /> RSS 采集正常
          </span>
        )}
        {sync.lastSuccessAt && <span>上次成功：{formatRelativeTime(sync.lastSuccessAt)}</span>}
        {sync.lastRunAt && <span>上次运行：{formatRelativeTime(sync.lastRunAt)}</span>}
        {sync.lastError && <span className="text-destructive">错误：{String(sync.lastError).slice(0, 80)}</span>}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">素材来源分布</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(counts.bySource).map(([source, n]) => (
              <div key={source} className="flex items-center justify-between text-sm">
                <span>{SOURCE_LABELS[source as MaterialSource] ?? source}</span>
                <Badge variant="muted">{n}</Badge>
              </div>
            ))}
            {Object.keys(counts.bySource).length === 0 && (
              <p className="text-sm text-muted-foreground">暂无素材，去导入或采集。</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">选题状态</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(TOPIC_STATUS_LABELS).map(([status, label]) => (
              <div key={status} className="flex items-center justify-between text-sm">
                <span>{label}</span>
                <Badge variant="muted">{counts.topics[status] ?? 0}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* 表现 Top5：发布后手动回填互动数据的稿件，按加权互动分排序 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="size-4" /> 表现 Top5
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {topDrafts.map((d, i) => (
            <Link
              key={d.id}
              href={`/drafts/${d.id}`}
              className="flex items-center gap-2 rounded-md border p-2 text-sm hover:bg-accent"
            >
              <span className="w-5 shrink-0 text-center font-semibold tabular-nums text-muted-foreground">
                {i + 1}
              </span>
              <Badge variant="outline" className="shrink-0">
                {PLATFORM_LABELS[d.platform as Platform] ?? d.platform}
              </Badge>
              <span className="min-w-0 flex-1 truncate">
                {d.title || d.topic_title || "无标题"}
              </span>
              {d.pillar && (
                <Badge variant="muted" className="hidden shrink-0 sm:inline-flex">
                  {d.pillar}
                </Badge>
              )}
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                互动分 {Math.round(d.engagement)}
              </span>
            </Link>
          ))}
          {topDrafts.length === 0 && (
            <p className="text-sm text-muted-foreground">发布后回填互动数据即可看到。</p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">进行中选题</CardTitle>
            <Link href="/topics" className="text-sm text-muted-foreground hover:text-foreground">
              全部 →
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {drafting.slice(0, 6).map((t) => (
              <Link
                key={t.id}
                href={`/topics/${t.id}`}
                className="block rounded-md border p-2 text-sm hover:bg-accent"
              >
                {t.title || t.angle || "未命名选题"}
              </Link>
            ))}
            {drafting.length === 0 && (
              <p className="text-sm text-muted-foreground">暂无进行中的选题。</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">待发布稿件</CardTitle>
            <Link href="/drafts" className="text-sm text-muted-foreground hover:text-foreground">
              全部 →
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingDrafts.slice(0, 6).map((d) => (
              <Link
                key={d.id}
                href={`/drafts/${d.id}`}
                className="flex items-center justify-between rounded-md border p-2 text-sm hover:bg-accent"
              >
                <span className="min-w-0 flex-1 truncate">{d.title || d.content?.slice(0, 30) || "无标题"}</span>
                <Badge variant="outline" className="shrink-0">{PLATFORM_LABELS[d.platform]}</Badge>
              </Link>
            ))}
            {pendingDrafts.length === 0 && (
              <p className="text-sm text-muted-foreground">暂无待发布稿件。</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
