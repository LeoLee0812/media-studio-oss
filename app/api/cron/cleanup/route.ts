import { NextResponse } from "next/server";
import { runCleanup } from "@/lib/cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 手动触发一轮全库清理（设置页按钮；middleware 已放行登录 cookie，Bearer CRON_SECRET 也可）。
// 与每日 cron（/api/cron/daily 内嵌的清理步骤）走同一条 runCleanup，口径完全一致。
// 此前清理只能等 cron 或本地跑 npm run cleanup，RSS 有手动按钮唯独清理没有，补齐对称性。
export async function POST() {
  try {
    const result = await runCleanup();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
