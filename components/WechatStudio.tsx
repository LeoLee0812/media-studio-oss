"use client";

/**
 * 公众号排版预览（WeMark 渲染引擎）：
 * AI 洗稿后的 wechat 稿件在右侧直接渲染成公众号排版效果，
 * 「复制到公众号」写入富文本剪贴板（text/html 内联样式），
 * 粘到公众号后台样式不丢。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { renderMarkdown, DEFAULT_OPTIONS, type RenderOptions } from "@/lib/wemark/renderer";
import { THEMES, PRIMARY_COLORS } from "@/lib/wemark/themes";
import { CODE_THEMES } from "@/lib/wemark/highlight";
import { renderXhs, xhsContentHash, type ParaEmoji } from "@/lib/xhs";
import { waitForXhsReady } from "@/lib/draft-tasks";
import { stripReferences, reflowProse } from "@/lib/format";
import { DouyinExport } from "@/components/DouyinExport";
import { Copy, Check, Loader2, Highlighter, Music2 } from "lucide-react";

const LS_KEY = "ms:wemark-options";

// AI 给小红书稿配的「醒目化」素材：高亮句（主角）+ 部分段落的 emoji（配角）
interface XhsAssist {
  phrases: string[];
  emojis: ParaEmoji[];
}

// 编辑区↔预览滚动同步的挂载点（由 DraftEditor 的 useScrollSync 传入）
interface ScrollSyncSide {
  ref: (el: HTMLElement | null) => void;
  onScroll: () => void;
}

export function WechatStudio({
  draftId,
  title,
  content,
  sync,
}: {
  draftId?: string;
  title: string;
  content: string;
  sync?: ScrollSyncSide;
}) {
  const [options, setOptions] = useState<RenderOptions>(DEFAULT_OPTIONS);
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedXhs, setCopiedXhs] = useState(false);
  // 小红书「醒目化」素材的内存缓存（按正文比对），与服务端中转缓存二级配合
  const xhsCache = useRef<{ content: string; data: XhsAssist } | null>(null);
  // 就绪状态跟着「缓存对应的正文」走：正文一改就自动回到未就绪
  const [xhsReadyFor, setXhsReadyFor] = useState<string | null>(null);
  const [xhsGenerating, setXhsGenerating] = useState(false);
  const [tip, setTip] = useState("");
  // 抖音长文导出面板的展开态（默认收起，点「抖音长文」展开）
  const [showDouyin, setShowDouyin] = useState(false);

  useEffect(() => {
    // 挂载标记 + 读 localStorage 属「与浏览器外部状态同步」，不是级联渲染，规则误报
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setOptions({ ...DEFAULT_OPTIONS, ...JSON.parse(raw) });
    } catch { /* 忽略 */ }
  }, []);

  // 打开稿件页时查一次服务端中转缓存：生成链路已预热过的稿子，按钮直接亮「已就绪」，点即秒贴
  useEffect(() => {
    if (!draftId || !content) return;
    let alive = true;
    fetch(`/api/drafts/${draftId}/xhs-highlight?hash=${xhsContentHash(content)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!alive || !json?.ready) return;
        const data: XhsAssist = {
          phrases: Array.isArray(json.phrases) ? json.phrases : [],
          emojis: Array.isArray(json.emojis) ? json.emojis : [],
        };
        xhsCache.current = { content, data };
        setXhsReadyFor(content);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // 只在挂载/换稿时查一次；编辑中的每次击键不查（点复制时自然会走后台生成）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  const patch = useCallback((p: Partial<RenderOptions>) => {
    setOptions((prev) => {
      const next = { ...prev, ...p };
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* 忽略 */ }
      return next;
    });
  }, []);

  const showTip = useCallback((msg: string, duration = 2500) => {
    setTip(msg);
    if (duration > 0) setTimeout(() => setTip(""), duration);
  }, []);

  // 渲染依赖 DOMParser，仅客户端执行。
  // 复制/预览统一剔除「参考资料」段（名词注释保留）；稿件正文本身不动。
  const html = useMemo(() => {
    if (!mounted) return "";
    try {
      // reflowProse：正文长段落按句末标点重排成「每段 1~2 句」，段间留白，观感更松弛
      return renderMarkdown(reflowProse(stripReferences(content ?? "")), options);
    } catch (e) {
      console.error("[wechat-studio] 渲染失败", e);
      return '<p style="color:#c00;">渲染出错，请检查 Markdown 内容</p>';
    }
  }, [content, options, mounted]);

  /**
   * 富文本复制：粘到公众号后台样式与预览一致，图片直接随 HTML 带过去。
   * 调研结论（doocs/md 同款机制）：公众号编辑器粘贴时会自动抓取外链 <img> 并转存到
   * mmbiz.qpic.cn；Pexels/Pixabay 是 https、无防盗链的稳定 CDN，转存成功率高。
   * 兜底：原图已在配图时下载到本地绑定文件夹（配图N-图注.jpg），个别图粘贴后
   * 加载失败就用同名本地文件在后台手动替换——不再用占位框整体挡掉图片。
   */
  const copyToWechat = useCallback(async () => {
    try {
      const hasImages = /<img\s/i.test(html);
      const tmp = document.createElement("div");
      tmp.innerHTML = html;
      document.body.appendChild(tmp);
      const plain = tmp.innerText;
      tmp.remove();
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      showTip(
        hasImages
          ? "已复制（含配图）。粘贴后等编辑器转存图片，个别加载失败的用本地同名原图替换 🎉"
          : "已复制，去公众号后台粘贴（标题另填）🎉",
      );
    } catch (e) {
      console.error("[wechat-studio] 复制失败", e);
      showTip("复制失败，请允许剪贴板权限");
    }
  }, [html, showTip]);

  /**
   * 复制到小红书长文：写「语义化 HTML」到 text/html，跟公众号那份 HTML 完全是两套东西。
   *
   * 小红书长文编辑器是 Tiptap，粘贴走 schema 白名单（h1/h2/p/ul/ol/blockquote/mark），
   * **内联样式一概无视**——公众号那份满是 <section style> 的 HTML 粘过去会被剥成纯文本，
   * 这就是「从公众号复制到小红书很丑」的根因。转换规则见 lib/xhs.ts。
   *
   * 两段式交互（2026-07-14 起，点击不再占剪贴板）：
   * - 缓存命中（生成链路预热过 / 之前点过）→ 立即渲染并写剪贴板，秒贴。
   * - 未命中 → **不碰剪贴板**，把「AI 挑高亮 + 配 emoji」踢到后台跑（30-40 秒），
   *   期间用户可以继续编辑、随意复制公众号内容；跑完提示「已就绪」，再点一次即秒贴。
   *   之前把 pending Promise 塞进 ClipboardItem 的写法会让剪贴板被挂起的写入占住，
   *   用户这 30 秒里复制的任何东西都会在完成时被覆盖——这就是被砍掉的原因。
   *
   * 高亮是小红书唯一的行内强调手段（没有加粗）：策略是高亮优先（逐段挑中心句），
   * emoji 只做点缀。AI 失败/未配引擎时退回确定性映射（加粗→高亮），不阻断复制。
   */
  const copyToXhs = useCallback(async () => {
    if (!mounted) return;

    const cached = xhsCache.current?.content === content ? xhsCache.current.data : null;

    // ---- 已就绪（或没有 draftId 无从生成）：同步渲染，直接在手势里写剪贴板 ----
    if (cached || !draftId) {
      try {
        const r = renderXhs(stripReferences(content ?? ""), {
          imageHints: true,
          highlights: cached?.phrases ?? [],
          emojis: cached?.emojis ?? [],
        });
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([r.html], { type: "text/html" }),
            "text/plain": new Blob([r.plain], { type: "text/plain" }),
          }),
        ]);
        setCopiedXhs(true);
        setTimeout(() => setCopiedXhs(false), 2000);
        const bits = [
          `已复制（${r.markCount} 处高亮 · ${r.emojiCount} 个 emoji）`,
          "去小红书「写长文」粘贴，标题另填",
        ];
        if (r.imageCount > 0) bits.push(`${r.imageCount} 张配图要手动上传`);
        showTip(`${bits.join("，")} 🎉`);
      } catch (e) {
        console.error("[wechat-studio] 复制到小红书失败", e);
        showTip("复制失败，请允许剪贴板权限");
      }
      return;
    }

    // ---- 未就绪：后台生成，不占剪贴板 ----
    if (xhsGenerating) {
      showTip("正在后台生成，完成会在这里提示，期间可继续编辑/复制公众号");
      return;
    }
    setXhsGenerating(true);
    showTip("小红书稿后台生成中（约 30 秒）——期间剪贴板不受影响，可继续编辑或复制公众号", 0);
    try {
      const res = await fetch(`/api/drafts/${draftId}/xhs-highlight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      let data: XhsAssist;
      if (res.status === 202) {
        // 服务端并发锁：同一份正文已有一次生成在跑（比如生成链路的预热），轮询等它出结果
        showTip("另一处已在生成同一份小红书稿（预热去重），等它完成即可…", 0);
        const assist = await waitForXhsReady(draftId, content);
        if (!assist) throw new Error("等待预热结果超时");
        data = assist;
      } else {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        data = {
          phrases: Array.isArray(json.phrases) ? json.phrases : [],
          emojis: Array.isArray(json.emojis) ? json.emojis : [],
        };
      }
      xhsCache.current = { content, data };
      setXhsReadyFor(content);
      showTip("✅ 小红书稿已就绪，点「复制小红书（已就绪）」即可粘贴", 12000);
    } catch (e) {
      // AI 挂了也给一条能走的路：确定性映射（加粗→高亮）照样能复制
      console.error("[wechat-studio] AI 高亮/emoji 失败", e);
      xhsCache.current = { content, data: { phrases: [], emojis: [] } };
      setXhsReadyFor(content);
      showTip("AI 高亮生成失败，已退回基础转换——再点一次可直接复制（无 AI 高亮）", 8000);
    } finally {
      setXhsGenerating(false);
    }
  }, [mounted, draftId, content, xhsGenerating, showTip]);

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">公众号排版预览</CardTitle>
          <div className="flex items-center gap-2">
            {/* 抖音长文：展开三段式导出面板（标题/摘要/正文各自复制） */}
            <Button
              variant={showDouyin ? "secondary" : "outline"}
              size="sm"
              onClick={() => setShowDouyin((v) => !v)}
            >
              <Music2 /> 抖音长文
            </Button>
            {/* 三态按钮：未就绪（点了踢后台生成，不占剪贴板）→ 生成中 → 已就绪（点即秒贴） */}
            <Button variant="outline" size="sm" onClick={copyToXhs}>
              {xhsGenerating ? (
                <Loader2 className="animate-spin" />
              ) : copiedXhs ? (
                <Check />
              ) : (
                <Highlighter />
              )}{" "}
              {xhsGenerating
                ? "小红书生成中…"
                : xhsReadyFor === content || !draftId
                  ? "复制小红书（已就绪）"
                  : "复制到小红书"}
            </Button>
            <Button size="sm" onClick={copyToWechat}>
              {copied ? <Check /> : <Copy />} 复制到公众号
            </Button>
          </div>
        </div>
        {/* 排版控件：主题 / 主色 / 字号 */}
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={options.themeId}
            onChange={(e) => patch({ themeId: e.target.value })}
            className="h-8 w-24 text-sm"
          >
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </Select>
          <div className="flex items-center gap-1.5">
            {PRIMARY_COLORS.map((c) => (
              <button
                key={c.value}
                title={c.label}
                onClick={() => patch({ primary: c.value })}
                className={`size-5 rounded-full transition-transform hover:scale-110 ${
                  options.primary === c.value ? "ring-2 ring-foreground ring-offset-1" : ""
                }`}
                style={{ background: c.value }}
              />
            ))}
          </div>
          <Select
            value={String(options.fontSize)}
            onChange={(e) => patch({ fontSize: Number(e.target.value) })}
            className="h-8 w-20 text-sm"
          >
            {[14, 15, 16, 17].map((s) => (
              <option key={s} value={s}>{s}px</option>
            ))}
          </Select>
          {/* 代码高亮主题（稿件含代码块时才有视觉差异） */}
          <Select
            value={options.codeThemeId}
            onChange={(e) => patch({ codeThemeId: e.target.value })}
            className="h-8 w-36 text-sm"
            title="代码高亮主题"
          >
            {CODE_THEMES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </Select>
          {tip && <span className="text-xs text-muted-foreground">{tip}</span>}
        </div>
      </CardHeader>
      <CardContent>
        {/* 抖音长文导出面板（展开时显示在预览上方） */}
        {showDouyin && (
          <DouyinExport draftId={draftId} title={title} content={content} bodyHtml={html} />
        )}
        {/* 预览独立滚动容器：与左侧编辑区做比例滚动同步（VS Code 预览式） */}
        <div
          ref={sync?.ref}
          onScroll={sync?.onScroll}
          className="max-h-[70vh] overflow-y-auto overscroll-contain rounded-xl"
        >
          {/* 手机宽度白底容器，模拟公众号阅读环境 */}
          <div className="mx-auto max-w-[400px] rounded-xl border bg-white p-4 shadow-sm">
            {title && (
              <h1 className="mb-1 border-b border-zinc-100 pb-3 text-[19px] font-bold leading-snug text-zinc-900">
                {title}
              </h1>
            )}
            <div dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </div>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          正文按所选主题渲染，复制后粘到公众号后台即为此效果；配图随粘贴自动转存到公众号素材库，个别失败的用本地备份原图手动替换；标题在后台单独填写
        </p>
      </CardContent>
    </Card>
  );
}
