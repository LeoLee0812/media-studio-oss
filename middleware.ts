import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, isGateEnabled, verifyToken } from "@/lib/auth";

// 全站门禁：未登录访问页面 → 重定向 /login；未授权裸调 API → 401。
// 没配 ACCESS_PASSWORD 时整站是「公开模式」——不拦任何请求，/login 也直接跳回落地页。
// 例外：落地页 "/" 与 "/home"（纯静态介绍页，不碰数据库）、/login 页、/api/auth/login。
// 定时/采集接口（/api/cron/* 与 /api/ingest/*）额外允许 Bearer CRON_SECRET。

const PUBLIC_PATHS = ["/", "/home", "/login", "/api/auth/login"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 公开模式：没设访问密码就不设门，登录页也没有意义，回落地页
  if (!isGateEnabled()) {
    if (pathname === "/login") {
      const url = req.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

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
