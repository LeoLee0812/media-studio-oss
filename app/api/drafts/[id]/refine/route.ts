import { NextResponse } from "next/server";
import { jsonSchema } from "ai";
import { getDraft } from "@/lib/queries";
import { getAntiAiRules, getPlatformSpec, getStyleSpec } from "@/lib/prompts";
import { llmConfigured } from "@/lib/config";
import { getLlmModel } from "@/lib/llm";
import { getPrompt } from "@/lib/prompt-store";
import { normalizeStyle } from "@/lib/styles";
import { styledGenerateObject } from "@/lib/styled-generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// AI 修改闭环：POST { feedback, title?, content? }
// 在当前稿（优先取前端传来的编辑区内容，可能尚未保存）基础上按反馈定向修改，
// 未被点名的部分尽量保留。只返回修改结果，不落库——由前端确认后再保存。
const REFINE_SCHEMA = jsonSchema({
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "修改后的标题；该平台没有标题（推特/知乎）就返回空字符串",
    },
    content: {
      type: "string",
      description: "修改后的完整正文（输出全文，不是 diff）",
    },
  },
  required: ["title", "content"],
  additionalProperties: false,
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await llmConfigured())) {
    return NextResponse.json({ error: "未配置 DEEPSEEK_API_KEY" }, { status: 501 });
  }
  const { id } = await params;
  const draft = await getDraft(id);
  if (!draft) return NextResponse.json({ error: "未找到" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const feedback: string = (body?.feedback ?? "").trim();
  if (!feedback) return NextResponse.json({ error: "请填写修改反馈" }, { status: 400 });

  // 优先用前端编辑区的最新内容（可能未保存），兜底用库里的稿件
  const curTitle: string =
    typeof body?.title === "string" ? body.title : draft.title ?? "";
  const curContent: string =
    typeof body?.content === "string" && body.content
      ? body.content
      : draft.content ?? "";
  if (!curContent.trim()) {
    return NextResponse.json({ error: "稿件正文为空，无从修改" }, { status: 400 });
  }

  // 沿用稿件自己的风格（meta.style），否则改一次就被默认调性洗回去
  const style = normalizeStyle(draft.meta?.style);

  // 风格总纲 + 平台规范 + 反 AI 规则一并注入，保证改完仍合规、文风不漂
  const [refineSystem, platformSpec, antiAi, styleSpec] = await Promise.all([
    getPrompt("refine_system"),
    getPlatformSpec(draft.platform, style),
    getAntiAiRules(),
    getStyleSpec(style),
  ]);

  try {
    // 走风格收口（styledGenerateObject）：finalCheck 追加 + 成稿净化统一在那里做，
    // 这条路径曾因手工织入而漏掉净化——带净化的风格稿改一次，破折号/双引号就全回来了
    const out = await styledGenerateObject({
      model: await getLlmModel({ structured: true }),
      schema: REFINE_SCHEMA,
      style,
      platform: draft.platform,
      temperature: 0.6,
      system: [
        refineSystem,
        styleSpec ? "## 写作风格（修改后仍须保持，文风类条款以此为准）\n" + styleSpec : "",
        platformSpec ? "## 目标平台规范（修改后仍须满足）\n" + platformSpec : "",
        antiAi ? "## 反 AI 写作铁律（修改的部分逐条自查）\n" + antiAi : "",
        "严格按要求的 JSON 结构输出修改后的全文，不要输出任何解释或 diff。中文成稿。",
      ],
      prompt: [
        `## 当前稿件（平台：${draft.platform}）`,
        curTitle ? `标题：${curTitle}` : "",
        `正文：\n${curContent}`,
        `## 用户修改反馈\n${feedback}`,
        "请在当前稿基础上按反馈修改，输出修改后的完整标题与正文。",
      ],
    });
    return NextResponse.json({
      title: String(out.title ?? ""),
      content: String(out.content ?? ""),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `AI 修改失败：${msg}` }, { status: 500 });
  }
}
