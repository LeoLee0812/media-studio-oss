"use client";

/**
 * 抖音长文导出面板：从公众号稿再导出一份「抖音创作者中心 - 发布文章」能直接用的内容。
 *
 * 抖音发布页是三个分离输入框（标题 / 摘要 / 正文），没法一次性粘一坨，所以这里做三个独立复制：
 * - 标题：纯文本，带 30 字计数（抖音标题上限 30）
 * - 摘要：AI 生成 3 个 ≤30 字的钩子候选择优复制（抖音摘要官方限「最多不超过 30 字」）
 * - 正文：主通道直接复用公众号 WeMark 富文本 HTML（text/html）——抖音正文编辑器和公众号一样，
 *   粘贴富文本时会把外链图片自动转存过去；lib/douyin.ts 的「结构化纯文本」只是 text/plain 兜底
 *   （见 lib/douyin.ts 头注释）。带 300–8000 字区间提醒
 *
 * 摘要几秒出结果，点一次现生成即可，不像小红书高亮要那套缓存/预热机制。
 */
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { charCount, stripReferences } from "@/lib/format";
import {
  renderDouyinBody,
  DOUYIN_TITLE_MAX,
  DOUYIN_SUMMARY_MAX,
  DOUYIN_BODY_MIN,
  DOUYIN_BODY_MAX,
} from "@/lib/douyin";
import { Copy, Check, Sparkles, Loader2, RefreshCw } from "lucide-react";

export function DouyinExport({
  draftId,
  title,
  content,
  bodyHtml,
}: {
  draftId?: string;
  title: string;
  content: string;
  /** 公众号排版渲染出的富文本 HTML（已剔除参考文献）：抖音正文和公众号一样，
   *  粘贴富文本时会把外链图片一起转存过去，所以正文复用这份 HTML 带图，不再走纯文本占位。 */
  bodyHtml?: string;
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState("");

  // 正文纯函数转换，随正文变化即时重算；先剔除「参考资料」段（名词注释保留）
  const bodyResult = useMemo(() => renderDouyinBody(stripReferences(content ?? "")), [content]);
  const titleLen = charCount(title ?? "");
  const titleOver = titleLen > DOUYIN_TITLE_MAX;
  const bodyLen = bodyResult.charCount;
  const bodyShort = bodyLen < DOUYIN_BODY_MIN;
  const bodyLong = bodyLen > DOUYIN_BODY_MAX;

  const flash = useCallback((key: string) => {
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000);
  }, []);

  // 标题/摘要走纯文本复制（抖音这两个是普通 input，不吃富文本）
  const copy = useCallback(
    async (key: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        flash(key);
      } catch (e) {
        console.error("[douyin] 复制失败", e);
        setErr("复制失败，请允许剪贴板权限");
      }
    },
    [flash],
  );

  /**
   * 正文复制：和公众号完全同一套富文本剪贴板（text/html + text/plain 兜底）。
   * 抖音正文编辑器和公众号一样，粘贴富文本时会自动把外链 <img> 转存过去——所以图片随粘贴带过来，
   * 不用再走「【配图N】占位 + 手动上传」。text/plain 放结构化纯文本，落到只吃纯文本的场景时兜底。
   */
  const copyBody = useCallback(async () => {
    try {
      const items: Record<string, Blob> = {
        "text/plain": new Blob([bodyResult.text], { type: "text/plain" }),
      };
      if (bodyHtml) items["text/html"] = new Blob([bodyHtml], { type: "text/html" });
      await navigator.clipboard.write([new ClipboardItem(items)]);
      flash("body");
    } catch (e) {
      console.error("[douyin] 复制正文失败", e);
      setErr("复制失败，请允许剪贴板权限");
    }
  }, [bodyHtml, bodyResult.text, flash]);

  const genSummary = useCallback(async () => {
    if (generating || !draftId) return;
    setGenerating(true);
    setErr("");
    try {
      const res = await fetch(`/api/drafts/${draftId}/douyin-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const list = Array.isArray(data.candidates) ? (data.candidates as string[]) : [];
      if (!list.length) throw new Error("摘要生成为空，请重试");
      setSummaries(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "摘要生成失败，请重试");
    } finally {
      setGenerating(false);
    }
  }, [generating, draftId, title, content]);

  return (
    <div className="mb-3 space-y-3 rounded-xl border border-primary/30 bg-primary/[0.03] p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">抖音长文</span>
        <span className="text-xs text-muted-foreground">
          抖音发布页三个框分开填，下面分别复制；正文走富文本粘贴，配图随粘贴带过去（同公众号）
        </span>
      </div>

      {/* 标题 */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">文章标题</label>
          <span className={"text-xs " + (titleOver ? "text-destructive" : "text-muted-foreground")}>
            {titleLen}/{DOUYIN_TITLE_MAX}
            {titleOver ? " · 超了，抖音标题最多 30 字" : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate rounded-md border bg-background px-2 py-1.5 text-sm">
            {title || <span className="text-muted-foreground">（无标题）</span>}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => copy("title", title)}
            disabled={!title.trim()}
          >
            {copiedKey === "title" ? <Check /> : <Copy />} 复制标题
          </Button>
        </div>
      </div>

      {/* 摘要 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">
            文章摘要（≤30 字 · 信息流里的钩子）
          </label>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={genSummary}
            disabled={generating || !draftId || !content.trim()}
          >
            {generating ? (
              <Loader2 className="animate-spin" />
            ) : summaries.length ? (
              <RefreshCw />
            ) : (
              <Sparkles />
            )}{" "}
            {generating ? "生成中…" : summaries.length ? "换一批" : "AI 生成摘要"}
          </Button>
        </div>
        {summaries.length === 0 && !generating && (
          <p className="text-xs text-muted-foreground">
            点「AI 生成摘要」出 3 个 ≤30 字的候选，择优复制填进抖音摘要框。
          </p>
        )}
        <div className="space-y-1.5">
          {summaries.map((s, i) => {
            const len = charCount(s);
            const over = len > DOUYIN_SUMMARY_MAX;
            const key = `sum-${i}`;
            return (
              <div key={key} className="flex items-center gap-2">
                <div className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-sm">
                  {s}
                </div>
                <span
                  className={
                    "shrink-0 text-xs tabular-nums " +
                    (over ? "text-destructive" : "text-muted-foreground")
                  }
                >
                  {len}/{DOUYIN_SUMMARY_MAX}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => copy(key, s)}
                >
                  {copiedKey === key ? <Check /> : <Copy />}
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      {/* 正文 */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">文章正文</label>
          <span
            className={
              "text-xs " + (bodyShort || bodyLong ? "text-destructive" : "text-muted-foreground")
            }
          >
            {bodyLen} 字
            {bodyShort ? ` · 抖音长文建议 ≥${DOUYIN_BODY_MIN} 字` : ""}
            {bodyLong ? ` · 超过 ${DOUYIN_BODY_MAX} 字上限` : ""}
          </span>
        </div>
        <Button size="sm" onClick={copyBody} disabled={!bodyResult.text}>
          {copiedKey === "body" ? <Check /> : <Copy />} 复制正文（含配图）
        </Button>
        {bodyResult.imageCount > 0 && (
          <p className="text-xs text-muted-foreground">
            正文含 {bodyResult.imageCount} 张配图 → 复制的是富文本，粘到抖音正文后图片随粘贴自动带过去（和公众号一样），个别加载失败的用本地同名原图替换。
          </p>
        )}
      </div>

      {/* 发布页手动补项：这些是抖音发布页的开关/表单，无法靠正文文本携带 */}
      <p className="text-xs text-muted-foreground">
        抖音发布页还需手动补：话题 #、原创/自主声明、合集、头图/封面、背景音乐（这些靠文本带不过去）。
      </p>

      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
