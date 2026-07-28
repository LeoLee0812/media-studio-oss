import { NextResponse } from "next/server";
import { ingestRss } from "@/lib/ingest";
import { translateNewMaterials } from "@/lib/translate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 手动触发 RSS 采集（设置页按钮）。
// 逐源串行抓取、错误按 feed 隔离，返回逐源明细供前端展示。
// 采集完顺手把新进的英文条目翻成中文（与每日 cron 同款收尾），翻译失败不影响采集结果。
export async function POST() {
  try {
    const result = await ingestRss();
    const translate = await translateNewMaterials().catch(() => null);
    return NextResponse.json({ ...result, translate });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
