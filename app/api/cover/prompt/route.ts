import { NextResponse } from "next/server";
import { generateCoverPrompt } from "@/lib/cover";
import { llmEnabled } from "@/lib/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// 生成封面图提示词：DeepSeek 读稿件 → 产出绘图提示词，返回前端供审阅/编辑
export async function POST(req: Request) {
  if (!(await llmEnabled())) {
    return NextResponse.json(
      { error: "未配置 DEEPSEEK_API_KEY，无法生成提示词" },
      { status: 501 },
    );
  }
  const body = await req.json().catch(() => ({})); // 非法 JSON 一律按空对象走后续校验（返回 400 而不是裸 500）
  const title: string = body?.title ?? "";
  const content: string = body?.content ?? "";
  // style 是封面风格套路 key（viral_tech / cinematic / huashu），老值自动回落默认套路
  const style: string = body?.style ?? "viral_tech";
  const ratio: string = body?.ratio ?? "2.35:1";
  if (!title && !content) {
    return NextResponse.json({ error: "标题和正文至少要有一个" }, { status: 400 });
  }
  try {
    const prompt = await generateCoverPrompt({ title, content, style, ratio });
    return NextResponse.json({ prompt });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
