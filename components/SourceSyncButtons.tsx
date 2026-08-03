"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

// 素材采集入口（素材流页 / 仪表盘共用）。
// 原来手动拉取只藏在设置页里——采集是日常动作，所以在素材流页和仪表盘平铺出来。
// 开源版只带 RSS 一个采集源（`/api/ingest/rss`）：订阅源在设置页自己配。想接别的源，
// 照 SOURCES 加一项 + 补一个 `/api/ingest/<id>` 路由即可，组件本身与具体源无关。
// 多源时「全部拉取」并行发起，单源时该按钮自动隐藏。

const SOURCES: { id: string; label: string; path: string }[] = [
  { id: "rss", label: "RSS", path: "/api/ingest/rss" },
];

// 各源返回结构不同，统一压成一句人话
function summarize(id: string, data: Record<string, unknown>): string {
  if (id === "rss") {
    const feeds = (data.feeds ?? []) as { url: string; label?: string; error?: string }[];
    const failed = feeds.filter((f) => f.error);
    let text = `RSS 拉取 ${data.fetched ?? 0} 条，新增 ${data.inserted ?? 0} 条`;
    if (failed.length > 0) {
      text += `；${failed.length} 个源失败：${failed
        .map((f) => `${f.label || f.url}（${f.error}）`)
        .join("，")}`;
    }
    return text;
  }
  return `新增 ${data.inserted ?? 0} 条（拉取 ${data.fetched ?? 0}）`;
}

export function SourceSyncButtons() {
  const router = useRouter();
  const [running, setRunning] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  async function pull(id: string): Promise<string> {
    const src = SOURCES.find((s) => s.id === id)!;
    try {
      const res = await fetch(src.path, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return `${src.label} 失败：${data.error || `HTTP ${res.status}`}`;
      return summarize(id, data);
    } catch {
      return `${src.label} 失败：网络错误`;
    }
  }

  async function runOne(id: string) {
    if (running) return;
    setRunning(id);
    setMsg("");
    setMsg(await pull(id));
    router.refresh();
    setRunning(null);
  }

  // 全部拉取：各源并行。它们打的是互不相干的外部接口、各自独立的 serverless 函数实例与
  // 连接池，串行只是白等成倍的时间；源内部该串的地方已经串好了（如 ingestRss 并行抓取、
  // 逐源串行落库）。pull() 内部吞掉异常并返回人话，一个源挂了不影响其余源的结果。
  async function runAll() {
    if (running) return;
    setRunning("all");
    setMsg("全部采集中…");
    const lines = await Promise.all(SOURCES.map((s) => pull(s.id)));
    setMsg(lines.join("；"));
    router.refresh();
    setRunning(null);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {SOURCES.map((s) => (
        <Button
          key={s.id}
          onClick={() => runOne(s.id)}
          disabled={running !== null}
          size="sm"
          variant="outline"
        >
          <RefreshCw className={running === s.id ? "animate-spin" : ""} />
          {running === s.id ? "采集中…" : `拉取 ${s.label}`}
        </Button>
      ))}
      {SOURCES.length > 1 && (
        <Button onClick={runAll} disabled={running !== null} size="sm">
          <RefreshCw className={running === "all" ? "animate-spin" : ""} />
          {running === "all" ? "全部采集中…" : "全部拉取"}
        </Button>
      )}
      {msg && <span className="text-sm text-muted-foreground break-all">{msg}</span>}
    </div>
  );
}
