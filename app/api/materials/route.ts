import { NextResponse } from "next/server";
import { listMaterials, updateMaterial, createMaterial } from "@/lib/queries";
import type { MaterialSource, MaterialStatus } from "@/lib/types";

// 板块归一化：自由分类字符串，trim 后长度 1-30 才有效，其余归一化为 null（未分类）
function normalizePillar(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length >= 1 && s.length <= 30 ? s : null;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 素材列表（按 source/pillar/status 筛选 + 关键词搜索）
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const materials = await listMaterials({
    source: (searchParams.get("source") as MaterialSource) || undefined,
    pillar: searchParams.get("pillar") || undefined,
    status: (searchParams.get("status") as MaterialStatus) || undefined,
    q: searchParams.get("q") || undefined,
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
  });
  return NextResponse.json({ materials });
}

// 手动录入素材：标题必填，url 可选；有 url 时按 url 幂等去重（重复返回 409）
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "标题必填" }, { status: 400 });

  const url = typeof body?.url === "string" && body.url.trim() ? body.url.trim() : null;
  const summary = typeof body?.summary === "string" && body.summary.trim() ? body.summary.trim() : null;
  const content = typeof body?.content === "string" && body.content.trim() ? body.content.trim() : null;
  const pillar = normalizePillar(body?.pillar);
  const tags: string[] = Array.isArray(body?.tags)
    ? body.tags.map((t: unknown) => String(t).trim()).filter(Boolean)
    : [];

  // 有 url 用 url 做去重键（同链接只录一次）；没 url 用随机键（永不冲突）
  const dedupeKey = url ? `manual:${url}` : `manual:${crypto.randomUUID()}`;
  const material = await createMaterial({
    source: "manual",
    dedupe_key: dedupeKey,
    title,
    url,
    summary,
    content,
    pillar,
    tags,
  });
  if (!material) {
    return NextResponse.json({ error: "该链接的素材已存在" }, { status: 409 });
  }
  return NextResponse.json({ material });
}

// 更新素材状态
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({})); // 非法 JSON 一律按空对象走后续校验（返回 400 而不是裸 500）
  const { id, ...patch } = body ?? {};
  if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  const allowed: Record<string, unknown> = {};
  if (patch.status) allowed.status = patch.status;
  if (patch.pillar) allowed.pillar = normalizePillar(patch.pillar);
  if (typeof patch.selected === "boolean") allowed.selected = patch.selected;
  const material = await updateMaterial(id, allowed);
  if (!material) return NextResponse.json({ error: "未找到" }, { status: 404 });
  return NextResponse.json({ material });
}
