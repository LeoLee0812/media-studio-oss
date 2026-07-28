import { NextResponse } from "next/server";
import { createTopic, listTopics } from "@/lib/queries";
import type { Pillar, TopicStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const topics = await listTopics({
    status: (searchParams.get("status") as TopicStatus) || undefined,
    pillar: (searchParams.get("pillar") as Pillar) || undefined,
  });
  return NextResponse.json({ topics });
}

// 新建选题（含从素材「立为选题」）
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})); // 非法 JSON 一律按空对象走后续校验（返回 400 而不是裸 500）
  if (!body?.title && !body?.angle) {
    return NextResponse.json({ error: "至少要有标题或角度" }, { status: 400 });
  }
  const topic = await createTopic({
    title: body.title,
    angle: body.angle,
    pillar: body.pillar,
    persona: body.persona,
    material_ids: body.material_ids,
    research: body.research,
    status: body.status,
    notes: body.notes,
  });
  return NextResponse.json({ topic });
}
