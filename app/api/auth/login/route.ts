import { NextResponse } from "next/server";
import { AUTH_COOKIE, expectedToken, verifyPassword } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ===== 登录防爆破：实例级内存限流 =====
// Map<ip, {fails, resetAt}>：10 分钟窗口内失败 ≥5 次直接 429。
// serverless 冷启动会重置计数，但配合「每次失败先等 500ms」的固定代价，
// 单实例内脚本爆破的吞吐已被压到没有实用价值（且全站仅一个密码、无用户名可枚举）。
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILS = 5;
const failMap = new Map<string, { fails: number; resetAt: number }>();

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// 取客户端 IP：Vercel/代理场景取 x-forwarded-for 首段
function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim() || "unknown";
  return req.headers.get("x-real-ip") ?? "unknown";
}

// 惰性清扫：Map 过大时把过期窗口清掉，防内存无限涨
function sweepExpired(now: number) {
  if (failMap.size < 1000) return;
  for (const [ip, rec] of failMap) {
    if (rec.resetAt <= now) failMap.delete(ip);
  }
}

// 校验 ACCESS_PASSWORD，设 HMAC httpOnly cookie
export async function POST(req: Request) {
  const ip = clientIp(req);
  const now = Date.now();
  sweepExpired(now);

  // 窗口内失败次数已达上限 → 直接拒绝
  const rec = failMap.get(ip);
  if (rec) {
    if (rec.resetAt <= now) {
      failMap.delete(ip); // 窗口已过，重新计数
    } else if (rec.fails >= MAX_FAILS) {
      const waitMin = Math.ceil((rec.resetAt - now) / 60000);
      return NextResponse.json(
        { error: `尝试次数过多，请约 ${waitMin} 分钟后再试` },
        { status: 429 },
      );
    }
  }

  let password = "";
  try {
    const body = await req.json();
    password = body?.password ?? "";
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  if (!verifyPassword(password)) {
    // 每次失败固定罚时 500ms，再记一次失败
    await sleep(500);
    const cur = failMap.get(ip);
    if (cur && cur.resetAt > Date.now()) {
      cur.fails += 1;
    } else {
      failMap.set(ip, { fails: 1, resetAt: Date.now() + WINDOW_MS });
    }
    return NextResponse.json({ error: "密码错误" }, { status: 401 });
  }

  // 登录成功清空该 IP 的失败计数
  failMap.delete(ip);

  const token = await expectedToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 天
  });
  return res;
}
