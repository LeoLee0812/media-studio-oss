import { NextResponse } from "next/server";
import {
  getTopic,
  updateTopic,
  getMaterials,
  listDrafts,
  appendTopicMaterials,
  deleteTopic,
} from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const topic = await getTopic(id);
  if (!topic) return NextResponse.json({ error: "未找到" }, { status: 404 });
  const [materials, drafts] = await Promise.all([
    getMaterials(topic.material_ids ?? []),
    listDrafts({ topic_id: id }),
  ]);
  return NextResponse.json({ topic, materials, drafts });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})); // 非法 JSON 一律按空对象走后续校验（返回 400 而不是裸 500）

  // 追加素材引用（「挂到选题」专用）：服务端原子合并去重。
  // 客户端只传新增 id，绝不再用页面加载时的旧数组整体覆盖——并发挂两条素材不会互相顶掉。
  const addIds: string[] = Array.isArray(body?.add_material_ids)
    ? body.add_material_ids.map(String).filter(Boolean)
    : [];

  const patch: Record<string, unknown> = {};
  for (const k of ["title", "angle", "pillar", "persona", "status", "notes", "priority", "research", "material_ids"]) {
    if (k in body) patch[k] = body[k];
  }
  if (Object.keys(patch).length === 0 && addIds.length === 0) {
    return NextResponse.json({ error: "无更新字段" }, { status: 400 });
  }

  let topic = null;
  if (addIds.length > 0) {
    topic = await appendTopicMaterials(id, addIds);
    if (!topic) return NextResponse.json({ error: "未找到" }, { status: 404 });
  }
  if (Object.keys(patch).length > 0) {
    topic = await updateTopic(id, patch);
    if (!topic) return NextResponse.json({ error: "未找到" }, { status: 404 });
  }
  return NextResponse.json({ topic });
}

// 删除选题：其下稿件随外键级联一并删除
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ok = await deleteTopic(id);
  if (!ok) return NextResponse.json({ error: "未找到" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
