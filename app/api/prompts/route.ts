import { NextResponse } from "next/server";
import {
  PROMPT_DEFS,
  getPromptDefault,
  getPromptOverrides,
  setPromptOverride,
} from "@/lib/prompt-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 提示词中心：GET 返回全部提示词（默认值 + 覆盖值），PUT 保存单条覆盖值
export async function GET() {
  const overrides = await getPromptOverrides();
  const items = await Promise.all(
    PROMPT_DEFS.map(async (d) => ({
      id: d.id,
      label: d.label,
      group: d.group,
      description: d.description,
      defaultText: await getPromptDefault(d.id),
      override: typeof overrides[d.id] === "string" ? overrides[d.id] : null,
    })),
  );
  return NextResponse.json({ items });
}

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id : "";
  const content = typeof body.content === "string" ? body.content : "";
  if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  try {
    await setPromptOverride(id, content);
    const overrides = await getPromptOverrides();
    return NextResponse.json({
      ok: true,
      override: typeof overrides[id] === "string" ? overrides[id] : null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
