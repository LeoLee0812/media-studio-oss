// ===== 稿件收尾任务（仅在客户端组件中使用）=====
// 「正文出来后」的三件事在这里收口成唯一一份实现：
//   ① 配图原图备份到本地（几秒）
//   ② 封面生图 + 裁剪 + 落盘（1-2 分钟）
//   ③ 小红书高亮/emoji 预热（30-100 秒，结果进服务端中转缓存）
// 此前选题页（TopicDetail.postDraftTasks）和洗稿页（rewrite/autoAssets）各写了一份
// 几乎逐字相同的编排，封面「取图→裁剪→拼文件名→保存」更是在 4 个组件里重复了 4 遍——
// 改一处漏三处就是这么来的。所有调用点（选题页/洗稿页/稿件页/封面卡片）统一走本模块。

import {
  cropToRatio,
  saveCoverImage,
  saveImageBlob,
  sanitizeFsName,
  getCoverFolderName,
  fallbackHint,
  type SaveOutcome,
} from "./cover-client";
import { xhsContentHash, type ParaEmoji } from "./xhs";
import type { Draft } from "./types";

export interface IllustrationRef {
  url: string;
  filename: string;
}

export interface XhsAssist {
  phrases: string[];
  emojis: ParaEmoji[];
}

// 封面文件名的唯一拼法（此前 4 个组件各拼了一遍）：封面-<标题前20字>-<比例>.png
export function coverFilename(title: string, ratio: string): string {
  return `封面-${(title || "未命名").slice(0, 20)}-${ratio.replace(":", "x")}.png`;
}

// 批量保存的汇总：几张进了文件夹、几张走了下载、几张失败，附一句兜底原因提示
export interface BatchSaveSummary {
  toFolder: number;
  toDownload: number;
  failed: number;
  hint: string;
}

// 配图原图逐张经 /api/images/proxy 拉取，存 绑定文件夹/<笔记名>/子图/
export async function downloadIllustrations(
  images: IllustrationRef[],
  noteTitle: string,
): Promise<BatchSaveSummary> {
  const noteDir = sanitizeFsName(noteTitle || "未命名");
  const summary: BatchSaveSummary = { toFolder: 0, toDownload: 0, failed: 0, hint: "" };
  for (const img of images) {
    try {
      const r = await fetch(`/api/images/proxy?url=${encodeURIComponent(img.url)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const out = await saveImageBlob(await r.blob(), img.filename, [noteDir, "子图"]);
      if (out.dest === "folder") summary.toFolder++;
      else {
        summary.toDownload++;
        summary.hint = summary.hint || fallbackHint(out);
      }
    } catch {
      summary.failed++;
    }
  }
  return summary;
}

export interface AiIllustrationRef {
  filename: string;
  url: string; // Vercel Blob 公网直链，与 /api/drafts/[id]/illustrate-ai 的返回一致
}

// AI 生成配图（认知锚点链路）逐张落盘：从 Blob 直链拉回来存
// 绑定文件夹/<笔记名>/AI配图/。走 /api/images/proxy 而不是浏览器直连，
// 理由与图库配图一致：不赌第三方 CDN 的 CORS 头，服务端转一手最稳
export async function downloadAiIllustrations(
  images: AiIllustrationRef[],
  noteTitle: string,
): Promise<BatchSaveSummary> {
  const noteDir = sanitizeFsName(noteTitle || "未命名");
  const summary: BatchSaveSummary = { toFolder: 0, toDownload: 0, failed: 0, hint: "" };
  for (const img of images) {
    try {
      const res = await fetch(`/api/images/proxy?url=${encodeURIComponent(img.url)}`);
      if (!res.ok) throw new Error(`代理下载失败 ${res.status}`);
      const blob = await res.blob();
      const out = await saveImageBlob(blob, img.filename, [noteDir, "AI配图"]);
      if (out.dest === "folder") summary.toFolder++;
      else {
        summary.toDownload++;
        summary.hint = summary.hint || fallbackHint(out);
      }
    } catch {
      summary.failed++;
    }
  }
  return summary;
}

export interface CoverSaveResult {
  ratio: string;
  outcome: SaveOutcome;
  folderName: string | null;
  noteDir: string;
}

// 服务端生图（图片与提示词落库）→ 按比例裁剪 → 落盘。失败抛 Error（带服务端错误原文）。
export async function generateAndSaveCover(
  draftId: string,
  noteTitle: string,
): Promise<CoverSaveResult> {
  const res = await fetch("/api/cover/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draftId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "封面生成失败");
  return saveCoverToDisk(data.b64, data.ratio || "2.35:1", noteTitle);
}

// 读服务端已落库的封面（不触发生图）→ 裁剪 → 落盘。没有落库封面时返回 null。
export async function downloadSavedCover(
  draftId: string,
  noteTitle: string,
): Promise<CoverSaveResult | null> {
  const res = await fetch(`/api/cover/image?draftId=${draftId}`);
  const data = res.ok ? await res.json() : null;
  if (!data?.found) return null;
  return saveCoverToDisk(data.b64, data.ratio || "2.35:1", noteTitle);
}

// 封面「裁剪 + 拼文件名 + 保存」的唯一实现
async function saveCoverToDisk(
  b64: string,
  ratio: string,
  noteTitle: string,
): Promise<CoverSaveResult> {
  const noteDir = sanitizeFsName(noteTitle || "未命名");
  const cropped = await cropToRatio(b64, ratio);
  const outcome = await saveCoverImage(cropped, coverFilename(noteTitle, ratio), [noteDir]);
  const folderName = await getCoverFolderName().catch(() => null);
  return { ratio, outcome, folderName, noteDir };
}

export type XhsWarmStatus = "ready" | "pending" | "failed";

// 小红书高亮预热：POST 到中转缓存接口。
// 200 → 已就绪（本次算完或缓存命中）；202 → 另一处正在生成（服务端并发锁），可轮询等它。
export async function warmXhsCache(
  draftId: string,
  content?: string,
): Promise<{ status: XhsWarmStatus; assist: XhsAssist }> {
  const empty: XhsAssist = { phrases: [], emojis: [] };
  try {
    const res = await fetch(`/api/drafts/${draftId}/xhs-highlight`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(content ? { content } : {}),
    });
    if (res.status === 202) return { status: "pending", assist: empty };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return {
      status: "ready",
      assist: {
        phrases: Array.isArray(json.phrases) ? json.phrases : [],
        emojis: Array.isArray(json.emojis) ? json.emojis : [],
      },
    };
  } catch {
    return { status: "failed", assist: empty };
  }
}

// 轮询等待小红书缓存就绪（配合 202 并发锁）：默认 5 秒一次、最多 3 分钟
export async function waitForXhsReady(
  draftId: string,
  content: string,
  { tries = 36, intervalMs = 5000 }: { tries?: number; intervalMs?: number } = {},
): Promise<XhsAssist | null> {
  const hash = xhsContentHash(content);
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    try {
      const res = await fetch(`/api/drafts/${draftId}/xhs-highlight?hash=${hash}`);
      const json = res.ok ? await res.json() : null;
      if (json?.ready) {
        return {
          phrases: Array.isArray(json.phrases) ? json.phrases : [],
          emojis: Array.isArray(json.emojis) ? json.emojis : [],
        };
      }
      // 服务端既没有结果也没有生成中标记 → 生成已失败，不用再等
      if (json && !json.pending) return null;
    } catch {
      // 单次查询失败不终止轮询
    }
  }
  return null;
}

// 三路并行收尾的回调：各任务自己报进度，谁先完成谁先亮
export interface PostDraftHandlers {
  onIllustMsg?: (msg: string) => void;
  onCoverMsg?: (msg: string) => void;
  onCoverBusy?: (busy: boolean) => void;
  onXhsMsg?: (msg: string) => void;
}

// 正文落库后的三路并行编排（选题页与洗稿页共用的唯一实现）。
// 服务端已插好配图 markdown（meta.illustrations）并写好封面提示词（meta.cover），
// 这里负责：配图原图落盘 ∥ 封面生图落盘 ∥ 小红书预热。全部结束后 resolve。
export async function runPostDraftTasks(
  draft: Draft,
  noteTitle: string,
  h: PostDraftHandlers = {},
): Promise<void> {
  const illustTask = (async () => {
    // 服务端按设置页预设决定走哪条配图链路：AI 生图落在 meta.aiIllustrations（存「AI配图」子目录），
    // 图库搜图落在 meta.illustrations（存「子图」子目录）。这里按实际产出分派下载。
    const aiImages = (draft.meta?.aiIllustrations ?? []) as AiIllustrationRef[];
    if (aiImages.length > 0) {
      h.onIllustMsg?.(`正文已插入 ${aiImages.length} 张 AI 图解，原图下载中…`);
      const s = await downloadAiIllustrations(aiImages, noteTitle);
      const parts = [`已插入 ${aiImages.length} 张 AI 图解`];
      if (s.toFolder) parts.push(`${s.toFolder} 张原图已备份到本地文件夹`);
      if (s.toDownload) parts.push(`${s.toDownload} 张走了浏览器下载（${s.hint || "可能被拦截"}）`);
      if (s.failed) parts.push(`${s.failed} 张备份失败（稿件页可重试）`);
      parts.push("复制到公众号时图片随富文本自动转存");
      h.onIllustMsg?.(parts.join("，"));
      return;
    }
    const images = (draft.meta?.illustrations ?? []) as IllustrationRef[];
    if (images.length === 0) {
      // 配图为空 = 服务端自动配图被跳过或失败了，说出来，别让用户以为「本来就没图」
      h.onIllustMsg?.(
        "本篇没有自动配图（设置页预设为「不配图」、未配置对应 key，或配图失败），稿件页可手动配图",
      );
      return;
    }
    h.onIllustMsg?.(`正文已插入 ${images.length} 张配图，原图下载中…`);
    const s = await downloadIllustrations(images, noteTitle);
    const parts = [`已插入 ${images.length} 张配图`];
    if (s.toFolder) parts.push(`${s.toFolder} 张原图已备份到本地文件夹`);
    // 浏览器下载兜底在非手势场景下大概率被 Chrome 拦截（多文件自动下载限制），要说实话
    if (s.toDownload) parts.push(`${s.toDownload} 张走了浏览器下载（${s.hint || "可能被拦截"}，可到稿件页点「下载图片」手动补）`);
    if (s.failed) parts.push(`${s.failed} 张备份失败（稿件页可点「下载图片」重试）`);
    parts.push("复制到公众号时图片随富文本自动转存");
    h.onIllustMsg?.(parts.join("，"));
  })();

  const coverTask = (async () => {
    h.onCoverBusy?.(true);
    h.onCoverMsg?.("正文已生成，封面图生成中（GPT Image 通常要 1-2 分钟）…");
    try {
      const r = await generateAndSaveCover(draft.id, noteTitle);
      h.onCoverMsg?.(
        r.outcome.dest === "folder"
          ? `封面已生成并存入「${r.folderName}/${r.noteDir}」（${r.ratio}）`
          : `封面已生成并触发下载（${r.ratio}）。${fallbackHint(r.outcome)}`,
      );
    } catch (e) {
      h.onCoverMsg?.(
        (e instanceof Error ? e.message : "封面生成失败") + "，可到稿件页手动重新生成。",
      );
    } finally {
      h.onCoverBusy?.(false);
    }
  })();

  const xhsTask = (async () => {
    h.onXhsMsg?.("小红书高亮后台预热中…");
    const r = await warmXhsCache(draft.id);
    if (r.status === "ready") {
      h.onXhsMsg?.(
        `小红书稿已就绪（${r.assist.phrases.length} 处高亮 · ${r.assist.emojis.length} 个 emoji），稿件页点「复制小红书」秒贴`,
      );
    } else if (r.status === "pending") {
      h.onXhsMsg?.("小红书高亮已有一份在后台生成（并发去重），稿件页点复制即可");
    } else {
      h.onXhsMsg?.("小红书高亮预热失败（不影响稿件），稿件页点复制时会重新生成");
    }
  })();

  await Promise.allSettled([illustTask, coverTask, xhsTask]);
}
