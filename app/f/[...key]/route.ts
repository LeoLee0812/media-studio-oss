import { NextResponse } from "next/server";
import { getBlob } from "@/lib/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 图片对象读取：GET /f/<prefix>/<对象名>
// 站内所有「换成公网直链」的图片（AI 配图、粘贴进正文的截图）都从这里出去，
// 底层是 R2 或 KV（见 lib/blob.ts）。公众号、知乎抓图时看到的也是这个地址。
//
// 注意 middleware 的 matcher 已把 .png/.jpg 这类后缀排除在门禁之外，
// 所以带密码门的站上，公众号那边的抓图程序也能直接取到图。

export async function GET(_req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { key } = await ctx.params;
  const objectKey = (key ?? []).join("/");
  if (!objectKey) return NextResponse.json({ error: "缺少对象 key" }, { status: 400 });

  const blob = await getBlob(objectKey);
  if (!blob) return NextResponse.json({ error: "图片不存在或已过期" }, { status: 404 });

  return new Response(blob.body, {
    headers: {
      "Content-Type": blob.contentType,
      // 内容按随机 key 寻址，写进去就不会变，可以放心长缓存
      "Cache-Control": "public, max-age=31536000, immutable",
      ...(blob.filename
        ? { "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(blob.filename)}` }
        : {}),
    },
  });
}
