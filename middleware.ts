import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, verifyToken } from "@/lib/auth";

// 全站门禁：未登录访问页面 → 重定向 /login；未授权裸调 API → 401。
// 例外：落地页 "/" 与 "/home"（纯静态介绍页，不碰数据库）、/login 页、/api/auth/login。
// 定时/采集接口（/api/cron/* 与 /api/ingest/*）额外允许 Bearer CRON_SECRET。

const PUBLIC_PATHS = ["/", "/home", "/login", "/api/auth/login"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const token = req.cookies.get(AUTH_COOKIE)?.value;
  const authed = await verifyToken(token);

  // cron / 外部脚本用 Bearer CRON_SECRET 调定时与采集接口。
  // 严格限定到这两类路径：CRON_SECRET 是窄用途凭据，绝不能拿它过 /api/config 等敏感接口
  // （否则可篡改 imageApiBase 造成带真实生图 key 的 SSRF/凭据外泄）。
  const cronSecret = process.env.CRON_SECRET;
  const bearer = req.headers.get("authorization");
  const bearerOk =
    !!cronSecret &&
    bearer === `Bearer ${cronSecret}` &&
    (pathname.startsWith("/api/ingest/") || pathname.startsWith("/api/cron/"));

  if (authed || bearerOk) {
    return NextResponse.next();
  }

  // API 裸调 → 401
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  // 页面 → 重定向登录，带上原路径以便登录后跳回
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("from", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // 排除静态资源与图标
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
