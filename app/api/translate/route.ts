import { NextResponse } from "next/server";
import { translateNewMaterials } from "@/lib/translate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 手动触发英文素材翻译（设置页「立即翻译」按钮）：把当前收件箱里
// 还没翻过的英文素材批量翻成中文。也是翻译引擎最直接的连通性测试。
export async function POST() {
  try {
    const result = await translateNewMaterials();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
