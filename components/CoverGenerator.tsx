"use client";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { ImageIcon, Wand2, Download, RefreshCw, FolderOpen } from "lucide-react";
import type { Draft, DraftMeta } from "@/lib/types";
import {
  cropToRatio,
  saveCoverImage,
  sanitizeFsName,
  chooseCoverFolder,
  getCoverFolderName,
  folderPickerSupported,
  fallbackHint,
} from "@/lib/cover-client";
import { coverFilename } from "@/lib/draft-tasks";

// 风格注册表是 lib/cover-styles.ts（纯数据、不引服务端模块），服务端与本组件共用同一份，
// 不再各抄一份常量
import {
  COVER_STYLES,
  COVER_RATIOS,
  resolveCoverStyle,
  recommendCoverStyles,
} from "@/lib/cover-styles";

/** 封面字段：锚点直生链路由文案引擎拆出来，服务端连同图片一起回传 */
interface CoverSpec {
  headline: string;
  deck: string;
  tags: string[];
  metaphor: string;
  elements: string;
}

interface CoverMeta {
  prompt?: string;
  style?: string;
  ratio?: string;
  generatedAt?: string;
  mode?: string;
  spec?: CoverSpec;
}

export function CoverGenerator({
  draft,
  title,
  content,
  noteDir,
}: {
  draft: Draft;
  // 编辑区实时的标题/正文（生成提示词用最新内容，不用落库的旧稿）
  title: string;
  content: string;
  // 图片子文件夹名（默认取稿件标题）：绑定文件夹/<笔记名>/封面-xxx.png
  noteDir?: string;
}) {
  const saved = ((draft.meta as DraftMeta | null)?.cover ?? {}) as CoverMeta;
  // 老稿件 meta 里可能存着已下线的风格值（cinematic / huashu / 不限…），统一回落到默认风格
  const [style, setStyle] = useState(resolveCoverStyle(saved.style).key);
  const [ratio, setRatio] = useState(saved.ratio ?? "2.35:1");
  const [prompt, setPrompt] = useState(saved.prompt ?? "");
  // 生成链路三选一：模板直生（带参考图）/ 锚点直生（无参考图，靠风格定义 + 拆出的字段）/
  // 提示词链路（旧，只有原生两套风格提供）。老稿件存过提示词就停在提示词链路，其余按
  // 该风格有没有模板参考图自动选前两条（tplAvail 加载完后在 effect 里定）
  const [mode, setMode] = useState<"template" | "anchor" | "prompt">(
    saved.mode === "template" || saved.mode === "anchor"
      ? saved.mode
      : saved.prompt
        ? "prompt"
        : "anchor",
  );
  // 各风格的模板参考图数量（服务端 /api/cover/templates），null = 还没加载完
  const [tplAvail, setTplAvail] = useState<Record<string, number> | null>(null);
  const [extra, setExtra] = useState("");
  const [spec, setSpec] = useState<CoverSpec | undefined>(saved.spec);
  const [promptLoading, setPromptLoading] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [imgSrc, setImgSrc] = useState("");
  const [msg, setMsg] = useState("");
  const [folderName, setFolderName] = useState<string | null>(null);

  const preset = resolveCoverStyle(style);
  const tplCount = tplAvail?.[style] ?? 0;
  const tplMissing = mode === "template" && tplAvail !== null && tplCount === 0;
  // 该稿件的推荐风格（纯关键词打分，本地算，不花 token）
  const recommended = recommendCoverStyles(title, content);

  // 切风格时：带入该风格的默认比例，并按有没有模板参考图自动落到对应的直生链路
  function pickStyle(key: string) {
    setStyle(key);
    const s = resolveCoverStyle(key);
    setRatio(s.defaultRatio);
    if (mode !== "prompt") setMode((tplAvail?.[key] ?? 0) > 0 ? "template" : "anchor");
    else if (!s.legacyPromptId) setMode((tplAvail?.[key] ?? 0) > 0 ? "template" : "anchor");
  }

  const dir = sanitizeFsName(noteDir || title || "未命名");

  // 挂载时：读已绑定的保存文件夹 + 拉取已落库的封面图（生成链路同步生成的会存在服务端）。
  // 关键：稿件有封面提示词但还没图（meta.cover.generatedAt 为空）＝生图很可能正在后台跑
  // （生成链路的封面任务要 1-2 分钟），此时**轮询直到出图**，出了图自动显示——
  // 这就是「正文出来了还要手动刷新才能看到封面」的修复。
  useEffect(() => {
    getCoverFolderName().then(setFolderName).catch(() => {});
    // 模板可用性：决定「模板直生」对哪些风格开放
    fetch("/api/cover/templates")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const avail: Record<string, number> = d?.styles ?? {};
        setTplAvail(avail);
        // 稿件没存过链路时，按当前风格有没有参考图落到模板直生 / 锚点直生
        if (!saved.mode && !saved.prompt) {
          setMode((avail[resolveCoverStyle(saved.style).key] ?? 0) > 0 ? "template" : "anchor");
        }
      })
      .catch(() => setTplAvail({}));
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // 只有「有提示词或标了模板直生、且没生成记录」才值得等：纯老稿子不轮询
    const maybeInFlight = (!!saved.prompt || saved.mode === "template") && !saved.generatedAt;
    let polls = 0;

    async function pull(): Promise<boolean> {
      try {
        const res = await fetch(`/api/cover/image?draftId=${draft.id}`);
        const data = res.ok ? await res.json() : null;
        if (!alive || !data?.found) return false;
        const cropped = await cropToRatio(data.b64, data.ratio || "2.35:1");
        if (!alive) return true;
        setImgSrc(cropped);
        setMsg(
          polls > 0
            ? `封面已在后台生成完毕，自动加载（${data.ratio}）。`
            : `已加载之前生成的封面（${data.ratio}）。`,
        );
        return true;
      } catch {
        return false;
      }
    }

    (async () => {
      const found = await pull();
      if (found || !maybeInFlight) return;
      if (alive) setMsg("封面正在后台生成（1-2 分钟），完成后会自动显示，无需刷新…");
      const tick = async () => {
        if (!alive) return;
        polls += 1;
        const ok = await pull();
        // 最多轮询 5 分钟（8 秒一次）：再没有就是生成失败了，提示手动生成
        if (!ok && alive) {
          if (polls < 38) timer = setTimeout(tick, 8000);
          else setMsg("封面迟迟没出来，可能后台生成失败了——可在下方手动生成。");
        }
      };
      timer = setTimeout(tick, 8000);
    })();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
    // saved.* 来自初始 meta，随 draft.id 一起变
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.id]);

  async function bindFolder() {
    try {
      const name = await chooseCoverFolder();
      setFolderName(name);
      setMsg(`封面将自动存入「${name}」文件夹`);
    } catch {
      // 用户取消选择时静默
    }
  }

  async function genPrompt() {
    setPromptLoading(true);
    setMsg("文案引擎正在根据稿件写提示词…");
    try {
      const res = await fetch("/api/cover/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content, style, ratio }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成提示词失败");
      setPrompt(data.prompt);
      setMsg("提示词已生成，可直接编辑后再生图。要改模板去「提示词」页。");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "生成提示词失败");
    } finally {
      setPromptLoading(false);
    }
  }

  const downloadName = coverFilename(title, ratio);

  async function genImage() {
    if (mode === "prompt" && !prompt.trim()) {
      setMsg("提示词为空，先生成或手写一段。");
      return;
    }
    setImageLoading(true);
    setMsg(
      mode === "template"
        ? "带模板参考图直出中，GPT Image 通常要 1-2 分钟…"
        : mode === "anchor"
          ? "先拆封面字段再按风格出图，通常要 1-2 分钟…"
          : "生图中，GPT Image 通常要 1-2 分钟…",
    );
    try {
      // 带 draftId：服务端把图片与链路信息一并落库，下次打开稿件页还在
      const body =
        mode === "template"
          ? { draftId: draft.id, mode, title, ratio, style, extra }
          : mode === "anchor"
            ? { draftId: draft.id, mode, title, content, ratio, style, extra }
            : { draftId: draft.id, prompt, ratio, style };
      const res = await fetch("/api/cover/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生图失败");
      if (data.spec) setSpec(data.spec as CoverSpec);
      const cropped = await cropToRatio(data.b64, ratio);
      setImgSrc(cropped);
      // 生成完自动保存：绑定过文件夹则静默写入 <笔记名>/ 子文件夹，否则触发浏览器下载
      const out = await saveCoverImage(cropped, downloadName, [dir]);
      setMsg(
        out.dest === "folder"
          ? `已生成并自动存入「${folderName}/${dir}」（${ratio}，裁剪自 ${data.size}）。`
          : `已生成并触发下载（${ratio}，裁剪自 ${data.size}）。${fallbackHint(out)}`,
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "生图失败");
    } finally {
      setImageLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ImageIcon className="size-4" /> AI 封面图（GPT Image）
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 比例 + 风格 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">比例</span>
          {COVER_RATIOS.map((r) => (
            <button
              key={r}
              onClick={() => setRatio(r)}
              className={
                "rounded-md border px-2.5 py-1 text-sm transition-colors " +
                (ratio === r ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")
              }
            >
              {r}
            </button>
          ))}
        </div>
        {/* 风格推荐：按稿件标题+正文关键词命中打分，本地算，纯提示不强制 */}
        {recommended.length > 0 && (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>为这篇稿推荐</span>
            {recommended.map((s) => (
              <button
                key={s.key}
                onClick={() => pickStyle(s.key)}
                className="rounded-full border border-dashed px-2 py-0.5 text-blue-500 transition-colors hover:bg-accent"
              >
                {s.label}
              </button>
            ))}
          </p>
        )}
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">风格</span>
            {COVER_STYLES.map((p) => (
              <button
                key={p.key}
                onClick={() => pickStyle(p.key)}
                title={`${p.hint}｜适合：${p.bestFor.join("、")}`}
                className={
                  "rounded-md border px-2.5 py-1 text-sm transition-colors " +
                  (style === p.key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:bg-accent")
                }
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {preset.hint}
            {mode === "prompt"
              ? "；提示词链路会把封面底部 15% 留成深色无字带，给公众号白色标题用。"
              : "；直生链路把封面底部 10% 留成干净留白带（无字、无图画，深浅色不限）。"}
          </p>
        </div>

        {/* 生成链路切换：两条直生链路都不用先写提示词——有参考图的风格照模板构思，
            没有参考图的风格靠「风格定义 + 版式骨架 + 文案引擎拆出的字段」立风格 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">链路</span>
          {(
            [
              { key: "template", label: "模板直生" },
              { key: "anchor", label: "锚点直生" },
              { key: "prompt", label: "提示词链路" },
            ] as const
          )
            // 迁移进来的 cc2image 风格没有旧提示词链路，按钮直接不给
            .filter((m) => m.key !== "prompt" || preset.legacyPromptId)
            .map((m) => (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                className={
                  "rounded-md border px-2.5 py-1 text-sm transition-colors " +
                  (mode === m.key ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")
                }
              >
                {m.label}
              </button>
            ))}
          <span className="text-xs text-muted-foreground">
            {mode === "template"
              ? tplAvail === null
                ? "模板加载中…"
                : tplMissing
                  ? "该风格还没有模板参考图，切「锚点直生」即可（风格靠文字定义，不用参考图）"
                  : `带 ${tplCount} 张参考图直出，标题即画面大字，不经文案引擎`
              : mode === "anchor"
                ? "文案引擎先拆出标题/导语/标签/隐喻/元素，再按该风格的风格定义直接出图"
                : "文案引擎按稿件写提示词，可审可改后再生图"}
          </span>
        </div>

        {mode !== "prompt" ? (
          /* 两条直生链路：只留一个可选的补充要求，画面交给图像模型按模板/风格定义构思 */
          <div className="space-y-2">
            <label className="text-sm font-medium">补充要求（可选）</label>
            <Textarea
              rows={2}
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder="想额外交代的画面要求，如：主体换成机器人 / 冷色调一点。留空即可。"
            />
            {mode === "anchor" && spec && (
              /* 锚点直生把文案引擎拆出的字段回显出来：出图不满意时，一眼能看出是字段拆歪了还是风格不对 */
              <div className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
                <p>本次封面字段（文案引擎拆的）：</p>
                <p className="mt-1">
                  主标题「{spec.headline}」／导语「{spec.deck}」
                  {spec.tags.length > 0 && `／标签 ${spec.tags.join("、")}`}
                </p>
                <p>视觉隐喻：{spec.metaphor}</p>
              </div>
            )}
          </div>
        ) : (
          /* 提示词链路（旧）：先由文案引擎生成，用户可审可改；模板本身在「提示词」页可编辑 */
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">绘图提示词（可编辑）</label>
              <Button size="sm" variant="outline" onClick={genPrompt} disabled={promptLoading}>
                <Wand2 /> {promptLoading ? "生成中…" : prompt ? "重新生成提示词" : "AI 生成提示词"}
              </Button>
            </div>
            <Textarea
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="点上方按钮让文案引擎根据稿件生成，也可以直接手写。确认满意后再生图。"
            />
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button
            onClick={genImage}
            disabled={
              imageLoading ||
              (mode === "template"
                ? tplMissing || tplAvail === null
                : mode === "prompt" && !prompt.trim())
            }
          >
            {imageLoading ? <RefreshCw className="animate-spin" /> : <ImageIcon />}
            {imageLoading ? "生图中…" : imgSrc ? "重新生成封面" : "生成封面图"}
          </Button>
          {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
        </div>

        {folderPickerSupported() && (
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <FolderOpen className="size-3.5" />
            自动保存位置：{folderName ? `「${folderName}」文件夹` : "浏览器默认下载目录"}
            <button type="button" onClick={bindFolder} className="text-blue-500 hover:underline">
              {folderName ? "更换文件夹" : "绑定本地文件夹（如 桌面/公众号-封面）"}
            </button>
          </p>
        )}

        {/* 结果预览 + 手动另存 */}
        {imgSrc && (
          <div className="space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imgSrc} alt="封面图预览" className="w-full rounded-lg border" />
            <div className="flex justify-end gap-2">
              {folderName && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const out = await saveCoverImage(imgSrc, downloadName, [dir]);
                    setMsg(out.dest === "folder" ? `已存入「${folderName}/${dir}」` : `已改为下载——${fallbackHint(out)}`);
                  }}
                >
                  <FolderOpen /> 存入文件夹
                </Button>
              )}
              <a
                href={imgSrc}
                download={downloadName}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                <Download /> 下载封面
              </a>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
