import { NextResponse } from "next/server";
import { generateObject, jsonSchema } from "ai";
import { getDraft } from "@/lib/queries";
import { llmConfigured } from "@/lib/config";
import { getFlashModel } from "@/lib/llm";
import { getPrompt } from "@/lib/prompt-store";
import { stripReferences } from "@/lib/format";
import { DOUYIN_SUMMARY_MAX } from "@/lib/douyin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 摘要只输出 3 条 ≤30 字的短句，flash 秒出，不像小红书高亮那样要跑长文，60 秒足够。
export const maxDuration = 60;

// 抖音长文「文章摘要」生成：POST { content?, title? } → { candidates: string[] }
//
// 抖音发布页的摘要字段官方限「最多不超过 30 字」，是信息流里标题之外的第二个拦截点。
// 这里给 3 个角度错开的钩子候选，让用户择优（也可点重新生成换一批）。
//
// 和小红书高亮不同，摘要输出极短、几秒出结果，**不需要**那套服务端缓存 / 并发锁 / 预热机制，
// 点一次现生成即可。也不落稿件正文：摘要只用于用户手动填进抖音发布页。

const SUMMARY_SCHEMA = jsonSchema({
  type: "object",
  properties: {
    candidates: {
      type: "array",
      description: "3 个抖音长文摘要候选，各不相同、角度错开，每个不超过 30 字",
      items: { type: "string" },
      minItems: 1,
      maxItems: 5,
    },
  },
  required: ["candidates"],
  additionalProperties: false,
});

/** 码点数（与抖音计数器口径一致，emoji/代理对算 1） */
function cpLen(s: string): number {
  return Array.from(s).length;
}

/**
 * 清洗单条摘要：去掉模型偶尔加的「1. 」编号、包裹的书名号/引号、首尾空白；
 * 超过 30 字的按码点硬截到 30（抖音输入框也是硬 maxLength，宁可截也不给超长的）。
 */
function cleanSummary(raw: string): string {
  let s = (raw ?? "").trim();
  s = s.replace(/^\s*\d+[.、)]\s*/, ""); // 去行首编号
  s = s.replace(/^[《「『"'"']+/, "").replace(/[》」』"'"']+$/, "").trim(); // 去整句包裹的书名号/引号
  if (cpLen(s) > DOUYIN_SUMMARY_MAX) {
    s = Array.from(s).slice(0, DOUYIN_SUMMARY_MAX).join("");
  }
  return s;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const draft = await getDraft(id);
  if (!draft) return NextResponse.json({ error: "未找到" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  // 前端可能正在编辑还没保存，优先用它传来的正文/标题
  const content: string =
    typeof body?.content === "string" && body.content ? body.content : draft.content ?? "";
  const title: string =
    typeof body?.title === "string" && body.title ? body.title : draft.title ?? "";
  if (!content.trim()) {
    return NextResponse.json({ error: "稿件正文为空" }, { status: 400 });
  }

  if (!(await llmConfigured())) {
    return NextResponse.json({ error: "未配置文案引擎 API Key" }, { status: 501 });
  }

  const system = await getPrompt("douyin_summary_system");
  const model = await getFlashModel({ structured: true });

  try {
    const { object } = await generateObject({
      model,
      schema: SUMMARY_SCHEMA,
      temperature: 0.8, // 摘要要有钩子、几条之间拉开差异，温度略高
      system,
      prompt: [
        `文章标题：${title || "（无标题）"}`,
        "",
        "正文内容：",
        stripReferences(content), // 参考文献对钩子没帮助，剔掉再喂模型
        "",
        "请按规则生成 3 个抖音长文「文章摘要」候选，每个不超过 30 字。",
      ].join("\n"),
    });

    const raw = Array.isArray((object as { candidates?: unknown }).candidates)
      ? ((object as { candidates: unknown[] }).candidates)
      : [];
    const seen = new Set<string>();
    const candidates = raw
      .map((c) => (typeof c === "string" ? cleanSummary(c) : ""))
      .filter((c) => c.length > 0)
      .filter((c) => {
        if (seen.has(c)) return false;
        seen.add(c);
        return true;
      })
      .slice(0, 3);

    if (!candidates.length) {
      return NextResponse.json({ error: "摘要生成为空，请重试" }, { status: 502 });
    }
    return NextResponse.json({ candidates });
  } catch (e) {
    console.error("[douyin-summary] 生成失败", e);
    return NextResponse.json({ error: "摘要生成失败，请重试" }, { status: 502 });
  }
}
