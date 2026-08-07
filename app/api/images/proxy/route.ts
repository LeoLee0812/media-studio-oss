import { NextResponse } from "next/server";
import { isAllowedImageHost } from "@/lib/image-search";

function safeHost(raw?: string): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 配图图片代理下载：GET ?url=<图片地址>
// 浏览器直接 fetch 第三方 CDN 会被 CORS 拦，走服务端转一手。
// 域名白名单只放行 Pexels/Pixabay（图库配图）和本站自己（AI 生成配图存 R2/KV，直链走 /f/），
// 防被当成通用代理（SSRF）。本站域名按真实请求 Host 取，不写死，换域名不用改代码。
export async function GET(req: Request) {
  const self = new URL(req.url);
  const url = self.searchParams.get("url") ?? "";
  const extraHosts = [self.hostname, safeHost(process.env.SITE_URL)].filter(Boolean) as string[];
  if (!url || !isAllowedImageHost(url, extraHosts)) {
    return NextResponse.json({ error: "仅允许代理 Pexels / Pixabay / 本站自身的图片地址" }, { status: 400 });
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
    if (!res.ok || !res.body) {
      return NextResponse.json({ error: `图片源返回 HTTP ${res.status}` }, { status: 502 });
    }
    const type = res.headers.get("content-type") ?? "image/jpeg";
    if (!type.startsWith("image/")) {
      return NextResponse.json({ error: "目标不是图片" }, { status: 502 });
    }
    return new Response(res.body, {
      headers: {
        "Content-Type": type,
        // 同一张图短期内可能预览+下载各取一次，给点缓存
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `下载失败：${msg}` }, { status: 502 });
  }
}
