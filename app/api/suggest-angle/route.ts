import { NextResponse } from "next/server";
import { generateObject, jsonSchema } from "ai";
import { getMaterial } from "@/lib/queries";
import { getLlmModel } from "@/lib/llm";
import { getPrompt } from "@/lib/prompt-store";
import { llmEnabled } from "@/lib/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 结构化输出：恰好 3 个差异化切入角度，每个带一句话理由
const SCHEMA = jsonSchema<{ suggestions: { angle: string; why: string }[] }>({
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          angle: {
            type: "string",
            description: "一句话切入角度，带个人视角，不能是素材标题的复述",
          },
          why: { type: "string", description: "一句话说明这个角度为什么值得写" },
        },
        required: ["angle", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["suggestions"],
  additionalProperties: false,
});

// 从模型返回的一项里救回 { angle, why }：可能是纯字符串，也可能键名漂移
function normalizeItem(raw: unknown): { angle: string; why: string } | null {
  if (typeof raw === "string") {
    const angle = raw.trim();
    return angle ? { angle, why: "" } : null;
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const pick = (keys: string[]) => {
      for (const k of keys) {
        const v = o[k];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
      return "";
    };
    const angle = pick(["angle", "切入角度", "视角", "点子", "标题", "title", "text"]);
    const why = pick(["why", "理由", "reason", "原因", "说明"]);
    // 键名全漂了：退回对象里最长的字符串值当角度
    if (!angle) {
      const longest = Object.values(o)
        .filter((v): v is string => typeof v === "string")
        .sort((a, b) => b.length - a.length)[0];
      if (longest?.trim()) return { angle: longest.trim(), why };
      return null;
    }
    return { angle, why };
  }
  return null;
}

// 兜底归一化：DeepSeek 常把数组放进别的键（如 angles）或把每项写成裸字符串，
// 导致顶层 suggestions 为 undefined、前端报「没有生成出可用的角度」。这里无论
// 数组挂在哪个键、每项什么形状，都尽力救成 { angle, why }[]。
function salvageSuggestions(obj: Record<string, unknown>): { angle: string; why: string }[] {
  const candidates: unknown[] = [];
  if (Array.isArray(obj.suggestions)) candidates.push(...obj.suggestions);
  else {
    // 优先取别名键的数组，否则取对象里第一个数组值
    const arr =
      (Array.isArray(obj.angles) && obj.angles) ||
      (Array.isArray(obj.切入角度) && obj.切入角度) ||
      (Array.isArray(obj.建议) && obj.建议) ||
      Object.values(obj).find((v) => Array.isArray(v));
    if (Array.isArray(arr)) candidates.push(...arr);
  }
  return candidates
    .map(normalizeItem)
    .filter((x): x is { angle: string; why: string } => x !== null);
}

// AI 建议选题切入角度：读素材，文案引擎产出 3 个差异化角度
export async function POST(req: Request) {
  if (!(await llmEnabled())) {
    return NextResponse.json(
      { error: "未配置文案引擎（DeepSeek API Key），先去设置页配置" },
      { status: 503 },
    );
  }
  const body = await req.json().catch(() => null);
  const materialId = typeof body?.material_id === "string" ? body.material_id : "";
  if (!materialId) return NextResponse.json({ error: "缺少 material_id" }, { status: 400 });

  const material = await getMaterial(materialId);
  if (!material) return NextResponse.json({ error: "素材未找到" }, { status: 404 });

  const system = await getPrompt("angle_system");

  const parts = [`标题：${material.title ?? ""}`];
  if (material.title_en) parts.push(`原标题：${material.title_en}`);
  // 板块是自由分类字符串，非空时直接拼进提示词供把握方向
  if (material.pillar) parts.push(`素材板块：${material.pillar}`);
  if (material.summary) parts.push(`摘要：${material.summary}`);
  if (material.content) parts.push(`正文节选：${material.content.slice(0, 4000)}`);
  if (material.tags?.length) parts.push(`标签：${material.tags.join("、")}`);

  try {
    const { object } = await generateObject({
      model: await getLlmModel({ structured: true }),
      schema: SCHEMA,
      system,
      prompt: `## 素材\n${parts.join("\n")}\n\n请给出 3 个差异化的选题切入角度。`,
      temperature: 0.9,
    });
    const suggestions = salvageSuggestions(
      object as Record<string, unknown>,
    ).slice(0, 3);
    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ error: "生成失败，请稍后重试" }, { status: 502 });
  }
}
