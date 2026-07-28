import { NextResponse } from "next/server";
import { templateAvailability } from "@/lib/cover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 各封面风格的模板参考图数量：{ styles: { viral_tech: 0, ... } }
// 前端据此决定「模板直生」对哪些风格可用（数量为 0 的风格只能走提示词链路）
export async function GET() {
  return NextResponse.json({ styles: await templateAvailability() });
}
