import { NextResponse } from "next/server";
import { jsonSchema } from "ai";
import { getDraft } from "@/lib/queries";
import { llmConfigured } from "@/lib/config";
import { getFlashModel } from "@/lib/llm";
import { getPrompt } from "@/lib/prompt-store";
import { getStyleDef, normalizeStyle } from "@/lib/styles";
import { styledGenerateObject } from "@/lib/styled-generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// AI 重写标题：POST { title?, content? } → { title }
// 轻量任务，固定走 deepseek-v4-flash（见 lib/llm.ts getFlashModel）。
// 只返回新标题，不落库——前端填回标题框，由用户确认后保存。
const TITLE_SCHEMA = jsonSchema({
  type: "object",
  properties: {
    title: { type: "string", description: "重写后的标题，14-26 个字" },
  },
  required: ["title"],
  additionalProperties: false,
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await llmConfigured())) {
    return NextResponse.json({ error: "未配置文案引擎 API Key" }, { status: 501 });
  }
  const { id } = await params;
  const draft = await getDraft(id);
  if (!draft) return NextResponse.json({ error: "未找到" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const curTitle: string = typeof body?.title === "string" ? body.title : draft.title ?? "";
  const curContent: string =
    typeof body?.content === "string" && body.content ? body.content : draft.content ?? "";
  if (!curContent.trim()) {
    return NextResponse.json({ error: "稿件正文为空，无从起标题" }, { status: 400 });
  }

  // 标题也跟着稿件自己的风格走（meta.style）：不同风格的标题调性差别很大
  const styleDef = getStyleDef(normalizeStyle(draft.meta?.style));
  const [titleSystem, styleTitle] = await Promise.all([
    getPrompt("title_system"),
    styleDef.titlePromptId ? getPrompt(styleDef.titlePromptId) : Promise.resolve(""),
  ]);
  const system = [titleSystem, styleTitle].filter(Boolean).join("\n\n");
  const prompt = [
    curTitle ? `当前标题：${curTitle}` : "当前没有标题。",
    // 标题只需要吃透主旨，正文给前 3000 字足够，顺带控住 flash 的输入成本
    `文章正文：\n${curContent.slice(0, 3000)}`,
    "请重写一个更抓人的标题。",
  ].join("\n\n");

  try {
    // 走风格收口：标题也要过风格自带的净化（AI 标题最爱用「：」）；
    // finalCheck 是面向整篇成稿的自查清单，标题场景关掉
    const object = await styledGenerateObject({
      model: await getFlashModel({ structured: true }),
      schema: TITLE_SCHEMA,
      style: normalizeStyle(draft.meta?.style),
      platform: draft.platform,
      temperature: 0.9,
      withFinalCheck: false,
      sanitizeFields: ["title"],
      system: [system],
      prompt: [prompt],
    });
    const title = String((object as { title?: unknown }).title ?? "").trim();
    if (!title) throw new Error("模型返回了空标题");
    return NextResponse.json({ title });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `AI 标题失败：${msg}` }, { status: 500 });
  }
}
