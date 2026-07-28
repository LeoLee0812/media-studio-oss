import { NextResponse } from "next/server";
import { createDraft, listDrafts } from "@/lib/queries";
import type { DraftStatus, Platform, Pillar } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const drafts = await listDrafts({
    status: (searchParams.get("status") as DraftStatus) || undefined,
    platform: (searchParams.get("platform") as Platform) || undefined,
    pillar: (searchParams.get("pillar") as Pillar) || undefined,
    topic_id: searchParams.get("topic_id") || undefined,
  });
  return NextResponse.json({ drafts });
}

// 手动新建稿件（一般由 /api/generate 或脚本创建）
const VALID_PLATFORMS: Platform[] = ["wechat"];

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})); // 非法 JSON 一律按空对象走后续校验（返回 400 而不是裸 500）
  if (!body?.platform) return NextResponse.json({ error: "缺少 platform" }, { status: 400 });
  // platform 白名单：非法值直接 400，不让脏枚举落库
  if (!VALID_PLATFORMS.includes(body.platform)) {
    return NextResponse.json({ error: `不支持的 platform：${body.platform}` }, { status: 400 });
  }
  const draft = await createDraft({
    topic_id: body.topic_id ?? null,
    platform: body.platform,
    title: body.title,
    content: body.content,
    meta: body.meta,
    generator: body.generator,
    status: body.status,
  });
  return NextResponse.json({ draft });
}
