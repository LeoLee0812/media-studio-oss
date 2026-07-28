import { NextResponse } from "next/server";
import { getMaterial } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 单条素材详情（含 content 全文等大字段）：inbox 卡片「查看全文」弹窗按需拉取
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const material = await getMaterial(id);
  if (!material) return NextResponse.json({ error: "未找到" }, { status: 404 });
  return NextResponse.json({ material });
}
