"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RSS_PRESETS } from "@/lib/rss-presets";
import { type SyncInfo, TimeText, useSectionSave } from "./shared";
import { ChevronDown, ChevronRight } from "lucide-react";

// RSS 源编辑行的本地形态
interface FeedRow {
  url: string;
  pillar: string;
  label: string;
}

// RSS 订阅源：源列表编辑 + 手动拉取 + 未处理素材保留天数 + 立即清理
export function RssFeedsCard({
  feeds: initialFeeds,
  sync,
  rssRetentionDays,
  lastPrunedAt,
}: {
  feeds: { url: string; pillar: string; label?: string }[];
  sync: SyncInfo | null;
  rssRetentionDays: number;
  /** 上次全库清理时间（sync_state 的 cleanup 键） */
  lastPrunedAt: string | null;
}) {
  const router = useRouter();
  const [feeds, setFeeds] = useState<FeedRow[]>(
    initialFeeds.map((f) => ({ url: f.url, pillar: f.pillar, label: f.label ?? "" })),
  );
  const [rssDays, setRssDays] = useState(String(rssRetentionDays));
  const { saving, msg, save } = useSectionSave();
  const retention = useSectionSave();

  // 预置源库：默认折叠，展开后可逐条/整组添加进上面的编辑列表（仍走「保存源列表」统一落库）
  const [presetsOpen, setPresetsOpen] = useState(false);
  // 已在编辑列表里的源地址集合（判断「已添加」置灰）
  const existingUrls = useMemo(() => new Set(feeds.map((f) => f.url.trim())), [feeds]);
  // 板块联想候选：预置分组名 + 当前列表里已有的分类名，去重保持出现顺序
  const pillarOptions = useMemo(() => {
    const set = new Set<string>();
    for (const g of RSS_PRESETS) set.add(g.category);
    for (const f of feeds) if (f.pillar.trim()) set.add(f.pillar.trim());
    return Array.from(set);
  }, [feeds]);

  // 添加单个预置源（已存在的静默跳过）
  function addPreset(category: string, feed: { label: string; url: string }) {
    setFeeds((arr) =>
      arr.some((f) => f.url.trim() === feed.url)
        ? arr
        : [...arr, { url: feed.url, pillar: category, label: feed.label }],
    );
  }

  // 整组添加：批量加入该组还没添加的源
  function addPresetGroup(category: string, groupFeeds: { label: string; url: string }[]) {
    setFeeds((arr) => {
      const urls = new Set(arr.map((f) => f.url.trim()));
      const missing = groupFeeds.filter((f) => !urls.has(f.url));
      return missing.length === 0
        ? arr
        : [...arr, ...missing.map((f) => ({ url: f.url, pillar: category, label: f.label }))];
    });
  }

  // 「立即清理」：调用与每日 cron 相同口径的 /api/cron/cleanup，展示各项回收数字
  const [cleaning, setCleaning] = useState(false);
  const [cleanMsg, setCleanMsg] = useState("");
  async function runCleanupNow() {
    setCleaning(true);
    setCleanMsg("");
    try {
      const res = await fetch("/api/cron/cleanup", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        const prunedText = Object.entries(data.pruned ?? {})
          .map(([source, n]) => `${source} ${n}`)
          .join("、");
        setCleanMsg(
          `清理完成：超期删除 ${prunedText || "0"} 条，回收封面 ${data.coversPurged} 张，回收小红书缓存 ${data.xhsPurged} 条`,
        );
        router.refresh();
      } else {
        setCleanMsg(data.error || "清理失败");
      }
    } catch {
      setCleanMsg("清理失败：网络错误");
    } finally {
      setCleaning(false);
    }
  }

  // 手动拉取全部 RSS 源
  const [pulling, setPulling] = useState(false);
  const [pullMsg, setPullMsg] = useState("");
  async function pullRss() {
    setPulling(true);
    setPullMsg("");
    try {
      const res = await fetch("/api/ingest/rss", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        const failed = (data.feeds ?? []).filter((f: { error?: string }) => f.error);
        let text = `拉取 ${data.fetched} 条，新增 ${data.inserted} 条`;
        if (failed.length > 0) {
          text += `；${failed.length} 个源失败：${failed
            .map((f: { label?: string; url: string; error?: string }) => `${f.label || f.url}（${f.error}）`)
            .join("，")}`;
        }
        setPullMsg(text);
        router.refresh();
      } else {
        setPullMsg(data.error || "拉取失败");
      }
    } catch {
      setPullMsg("拉取失败：网络错误");
    } finally {
      setPulling(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">RSS 订阅源</CardTitle>
        <Button size="sm" variant="outline" disabled={pulling} onClick={pullRss}>
          {pulling ? "拉取中…" : "手动拉取"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {pullMsg && <p className="text-xs text-muted-foreground break-all">{pullMsg}</p>}
        <div className="flex items-center justify-between gap-3">
          <span>上次成功拉取</span>
          <TimeText iso={sync?.lastSuccessAt} />
        </div>
        {sync?.lastError && (
          <div className="space-y-1 rounded-md bg-red-500/10 px-3 py-2 text-xs">
            <div className="flex items-center justify-between gap-3 text-red-500">
              <span className="font-medium">最近错误</span>
              <TimeText iso={sync.lastErrorAt} className="text-red-500" />
            </div>
            <p className="break-all text-red-500">{sync.lastError}</p>
          </div>
        )}
        {feeds.length === 0 && (
          <p className="text-xs text-muted-foreground">
            还没有订阅源。点「添加源」粘贴 RSS/Atom 地址，或展开下方「预置源库」一键添加。
          </p>
        )}
        <div className="space-y-3">
          {feeds.map((f, i) => (
            <div key={i} className="space-y-2 rounded-md border p-3">
              <Input
                value={f.url}
                onChange={(e) =>
                  setFeeds((arr) => arr.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
                }
                placeholder="https://example.com/feed（RSS 2.0 / Atom）"
              />
              <div className="flex flex-wrap items-center gap-2">
                {/* 板块 = 自由分类字符串：文本输入 + datalist 联想（预置分组名 + 已有分类名） */}
                <Input
                  value={f.pillar}
                  onChange={(e) =>
                    setFeeds((arr) => arr.map((x, j) => (j === i ? { ...x, pillar: e.target.value } : x)))
                  }
                  placeholder="板块，如：AI 资讯"
                  list="rss-pillar-options"
                  className="w-36"
                />
                <Input
                  value={f.label}
                  onChange={(e) =>
                    setFeeds((arr) => arr.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                  }
                  placeholder="备注名（可选）"
                  className="min-w-32 flex-1"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-500"
                  onClick={() => setFeeds((arr) => arr.filter((_, j) => j !== i))}
                >
                  删除
                </Button>
              </div>
            </div>
          ))}
        </div>
        {/* 板块联想候选（datalist 全卡片共享一份） */}
        <datalist id="rss-pillar-options">
          {pillarOptions.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setFeeds((arr) => [...arr, { url: "", pillar: "", label: "" }])}
          >
            添加源
          </Button>
          <Button
            size="sm"
            disabled={saving}
            onClick={() =>
              save({
                rssFeeds: feeds
                  .filter((f) => f.url.trim())
                  .map((f) => ({ url: f.url.trim(), pillar: f.pillar, label: f.label.trim() || undefined })),
              })
            }
          >
            {saving ? "保存中…" : "保存源列表"}
          </Button>
          {msg && <span className="text-muted-foreground">{msg}</span>}
        </div>
        <p className="text-xs text-muted-foreground">
          每日定时任务会逐源抓取（一个源失败不影响其他），按链接去重入库到对应板块。
        </p>

        {/* 预置源库：默认折叠的紧凑区块，按分组一键添加，仍走上面的「保存源列表」统一落库 */}
        <div className="border-t pt-3">
          <button
            type="button"
            onClick={() => setPresetsOpen((v) => !v)}
            className="flex w-full items-center gap-1.5 text-sm font-medium hover:text-foreground"
          >
            {presetsOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            预置源库
            <span className="font-normal text-xs text-muted-foreground">
              {RSS_PRESETS.length} 组开箱即用的订阅源，添加后记得保存
            </span>
          </button>
          {presetsOpen && (
            <div className="mt-3 space-y-4">
              {RSS_PRESETS.map((group) => {
                const allAdded = group.feeds.every((f) => existingUrls.has(f.url));
                return (
                  <div key={group.category} className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-sm font-medium">{group.category}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{group.description}</span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={allAdded}
                        onClick={() => addPresetGroup(group.category, group.feeds)}
                      >
                        {allAdded ? "整组已添加" : "整组添加"}
                      </Button>
                    </div>
                    <div className="space-y-1">
                      {group.feeds.map((feed) => {
                        const added = existingUrls.has(feed.url);
                        return (
                          <div
                            key={feed.url}
                            className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5"
                          >
                            <div className="min-w-0">
                              <span className="text-sm">{feed.label}</span>
                              <span className="ml-2 hidden truncate text-xs text-muted-foreground sm:inline">
                                {feed.url}
                              </span>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={added}
                              className="shrink-0"
                              onClick={() => addPreset(group.category, feed)}
                            >
                              {added ? "已添加" : "添加"}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 未处理素材保留天数 + 全库清理（随素材源收窄挪到 RSS 卡片统一管理） */}
        <div className="space-y-3 border-t pt-3">
          <div className="space-y-1">
            <label className="text-muted-foreground">
              未处理素材保留天数（超期直接删除；保护已入选/已用/已挂选题；手动录入永不清理）
            </label>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min={1}
                value={rssDays}
                onChange={(e) => setRssDays(e.target.value)}
                className="w-20"
              />
              <Button
                size="sm"
                disabled={retention.saving}
                onClick={() => retention.save({ rssRetentionDays: Number(rssDays) })}
              >
                {retention.saving ? "保存中…" : "保存"}
              </Button>
              {retention.msg && <span className="text-muted-foreground">{retention.msg}</span>}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>上次清理</span>
            <TimeText iso={lastPrunedAt} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="outline" disabled={cleaning} onClick={runCleanupNow}>
              {cleaning ? "清理中…" : "立即清理"}
            </Button>
            {cleanMsg && <span className="text-xs text-muted-foreground break-all">{cleanMsg}</span>}
          </div>
          <p className="text-xs text-muted-foreground">
            每日定时任务自动清理超期未处理的 RSS 素材，并回收公众号封面图
            （稿件已删的孤儿图、超 24 小时的旧图——封面已存本地文件夹，库里只是回显副本）。
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
