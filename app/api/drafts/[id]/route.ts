import { NextResponse } from "next/server";
import {
  getDraft,
  updateDraft,
  getTopic,
  deleteDraft,
  markTopicMaterialsUsed,
  maybeCompleteTopic,
} from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const draft = await getDraft(id);
  if (!draft) return NextResponse.json({ error: "未找到" }, { status: 404 });
  const topic = draft.topic_id ? await getTopic(draft.topic_id) : null;
  return NextResponse.json({ draft, topic });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})); // 非法 JSON 一律按空对象走后续校验（返回 400 而不是裸 500）
  const patch: Record<string, unknown> = {};
  // 白名单制更新：只接受这些字段
  for (const k of ["title", "content", "meta", "status", "published_url", "published_at", "version"]) {
    if (k in body) patch[k] = body[k];
  }
  // 状态置为已发布时自动补发布时间
  if (patch.status === "published" && !patch.published_at) {
    patch.published_at = new Date().toISOString();
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "无更新字段" }, { status: 400 });
  }
  const draft = await updateDraft(id, patch);
  if (!draft) return NextResponse.json({ error: "未找到" }, { status: 404 });

  // 发布闭环：状态推到 published 时，把选题引用的素材推「已用」，
  // 选题下全部稿件都发完则把选题推「完成」。失败不影响保存本身。
  if (patch.status === "published" && draft.topic_id) {
    try {
      await Promise.all([
        markTopicMaterialsUsed(draft.topic_id),
        maybeCompleteTopic(draft.topic_id),
      ]);
    } catch (e) {
      console.error("发布闭环推进失败", e);
    }
  }

  return NextResponse.json({ draft });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ok = await deleteDraft(id);
  if (!ok) return NextResponse.json({ error: "未找到" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
