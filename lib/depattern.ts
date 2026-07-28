import { generateObject, jsonSchema } from "ai";
import { getFlashModel } from "./llm";
import { getPrompt } from "./prompt-store";

// ===== 认知反转句净化（第二道防线）=====
// 「不是A，而是B」这族句式提示词只能压低频率、压不到零（否定指令的粉红大象效应：
// 禁令本身会激活句式模板，模型换个皮就绕过了）。这里做代码级兜底：
// 正则定位命中句 → 超过阈值时把「多出来的句子」交给轻量模型逐句改写 → 原位替换。
// 只改命中句、不做全文重写——全文重写等于再走一遍模型默认文风，实测会越改越 AI。
//
// 阈值设计：全文保留 1 句（人类写作里真正的核心转折用一次是正常修辞），
// 第 2 句起才改写。误伤面近似为零，成本是每篇最多一次 flash 级小调用。

// 同句共现的句式对：[前半标记, 后半标记]。句内两个都命中才算认知反转句。
const CONTRAST_PAIRS: [RegExp, RegExp][] = [
  [/不是|不再是|并非/, /而是/],
  [/与其说/, /不如说/],
  [/表面上/, /实际上|实则|真正/],
  [/不仅仅?是/, /更是/],
];

/** 允许保留的命中句数量：第 1 句放行（合理修辞），之后的才改写 */
const KEEP_COUNT = 1;

// 分句：按句末标点切（保留标点跟随句子），换行也视为边界
function splitSentences(text: string): string[] {
  return text.split(/(?<=[。！？；!?])|\n/).filter((s) => s.trim().length > 0);
}

/** 找出文本里的认知反转句（按出现顺序） */
export function findContrastSentences(text: string): string[] {
  const hits: string[] = [];
  for (const s of splitSentences(text)) {
    if (CONTRAST_PAIRS.some(([a, b]) => a.test(s) && b.test(s))) hits.push(s);
  }
  return hits;
}

const REWRITE_SCHEMA = jsonSchema<{ rewrites: { id: number; text: string }[] }>({
  type: "object",
  properties: {
    rewrites: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "number" }, text: { type: "string" } },
        required: ["id", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["rewrites"],
  additionalProperties: false,
});

/**
 * 净化一段成稿：认知反转句超过 KEEP_COUNT 时，多出来的逐句改写后原位替换。
 * 失败安全：模型调用失败/漏改一律返回已改好的部分或原文，绝不让净化挂掉出稿主流程。
 */
export async function dePatternText(text: string): Promise<string> {
  const hits = findContrastSentences(text);
  if (hits.length <= KEEP_COUNT) return text;

  const targets = hits.slice(KEEP_COUNT);
  try {
    const model = await getFlashModel({ structured: true });
    const system = await getPrompt("depattern_system");
    const input = targets.map((s, i) => ({ id: i, sentence: s }));
    const { object } = await generateObject({
      model,
      schema: REWRITE_SCHEMA,
      system,
      prompt: `改写以下 ${input.length} 个句子：\n${JSON.stringify(input, null, 2)}`,
      temperature: 0.4,
    });

    let out = text;
    for (const r of object.rewrites ?? []) {
      const src = targets[r.id];
      const rewritten = r.text?.trim();
      if (!src || !rewritten) continue;
      // 改写结果自己又带句式的，弃用（防模型敷衍换皮）
      if (CONTRAST_PAIRS.some(([a, b]) => a.test(rewritten) && b.test(rewritten))) continue;
      out = out.replace(src, rewritten);
    }
    return out;
  } catch {
    return text; // 净化失败不影响出稿
  }
}
