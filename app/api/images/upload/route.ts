import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 粘贴/拖拽进正文的图片上传：POST multipart/form-data { file }，传 Vercel Blob 换公网直链。
// 为什么必须换成外链（与 AI 配图链路同一条理由，见 lib/illustrate-ai.ts 的长注释）：
// ① 公众号编辑器粘贴富文本时只会抓取外链 <img> 转存，base64 内嵌粘不过去；
// ② base64 直接写进 ms_drafts.content 会让正文涨到 MB 级。
// 请求体上限：Vercel Serverless 是 4.5MB，所以前端在上传前先压过一轮（lib/paste-image.ts）。
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "请求体解析失败（不是 multipart/form-data？）" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少 file 字段" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: `只支持图片，收到 ${file.type || "未知类型"}` }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `图片太大（${(file.size / 1024 / 1024).toFixed(1)}MB），上限 4MB` },
      { status: 413 },
    );
  }

  try {
    const { put } = await import("@vercel/blob");
    const ext = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
    const name = (form.get("filename") as string | null)?.trim() || `粘贴图片.${ext}`;
    // addRandomSuffix：不同稿件粘的截图重名很常见，加随机后缀避免互相覆盖
    const blob = await put(`pasted/${name}`, file, {
      access: "public",
      contentType: file.type,
      addRandomSuffix: true,
    });
    return NextResponse.json({ url: blob.url, size: file.size, type: file.type });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `上传失败：${msg}` }, { status: 500 });
  }
}
