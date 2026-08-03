"use client";

// ===== 粘贴 / 拖拽图片进正文 =====
// textarea 是纯文本控件，浏览器对「粘贴一张图」本身不做任何事——必须自己在 paste/drop
// 事件里把 clipboardData 里的图片取出来、上传换成公网直链，再把 Markdown 图片语法插到光标处。
// 直链而不是 base64 的理由与 AI 配图链路一致：base64 粘不进公众号，还会把正文撑到 MB 级。

// 上传前先在浏览器压一轮：Retina 截图动辄 5-10MB，超过 Vercel Serverless 的 4.5MB 请求体上限。
// 压到最长边 1920（公众号正文宽度 677px，1920 已经绰绰有余）+ JPEG 0.9。
const MAX_EDGE = 1920;
const JPEG_QUALITY = 0.9;
// 已经足够小的图直接原样传，免得把干净的 PNG 白白转成 JPEG（截图里的文字最怕二次压缩）
const SKIP_COMPRESS_BYTES = 800 * 1024;

/** 从粘贴/拖拽事件里挑出图片文件；没有图片返回空数组 */
export function extractImageFiles(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const out: File[] = [];
  // files 在粘贴截图与拖拽本地文件两种场景下都有；items 兜底（某些浏览器粘贴只填 items）
  for (const f of Array.from(dt.files)) {
    if (f.type.startsWith("image/")) out.push(f);
  }
  if (out.length === 0) {
    for (const item of Array.from(dt.items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) out.push(f);
      }
    }
  }
  return out;
}

/** canvas 等比缩到最长边 MAX_EDGE 内并转 JPEG；解码失败就原样返回，不阻断上传 */
async function compressImage(file: File): Promise<File> {
  if (file.size <= SKIP_COMPRESS_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    // 透明底转 JPEG 会变黑，先铺一层白（截图基本不透明，这一步只是兜底）
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob || blob.size >= file.size) return file; // 压完反而更大就别压了
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/** 压缩 + 上传，返回 Vercel Blob 公网直链；失败抛 Error（带服务端错误原文） */
export async function uploadPastedImage(file: File): Promise<string> {
  const compressed = await compressImage(file);
  const form = new FormData();
  form.append("file", compressed);
  form.append("filename", compressed.name || "粘贴图片.jpg");
  const res = await fetch("/api/images/upload", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `上传失败 HTTP ${res.status}`);
  return String(data.url);
}

/** 在 text 的 [start, end) 处替换成 insert，返回新文本与替换后的光标位置 */
export function spliceText(text: string, start: number, end: number, insert: string) {
  return {
    text: text.slice(0, start) + insert + text.slice(end),
    caret: start + insert.length,
  };
}
