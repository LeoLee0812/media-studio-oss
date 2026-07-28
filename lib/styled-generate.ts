/**
 * 风格感知的模型调用收口。
 *
 * 「写作风格」是横切关注点，切生成链路的五个层面：
 *   ① system 风格总纲（getStyleSpec）② 平台规范替换（getPlatformSpec）③ schema 约束覆盖
 *   ④ prompt 末尾 finalCheck ⑤ 成稿确定性净化（sanitize）
 * ①②③是「取哪段提示词」的声明式查表，已各自收口；④⑤是纯机械动作，
 * 曾经靠各调用点手工织入，结果 AI 修改/AI 标题两条路径漏了净化——改一次稿，
 * 破折号和双引号就全回来了。
 *
 * 因此约定：**凡是模型输出会成为稿件标题/正文的 generateObject 调用，一律走
 * styledGenerateObject**，finalCheck 追加和净化由它统一负责，新增出稿路径不可能再漏。
 * （母稿走 generateText 属于内部中间产物，不发布，不在此列。）
 */
import { generateObject, type jsonSchema } from "ai";
import { effectiveStyle, getStyleDef, type WritingStyle } from "./styles";
import { dePatternText } from "./depattern";
import type { Platform } from "./types";

/**
 * 公众号稿的参考来源节标题。normalize 生成时统一追加；净化时以它为界，
 * 只洗模型写的正文，来源节（含链接、机构名、原文标题）原样保留。
 */
export const SOURCES_HEADING = "\n\n## 参考来源";

/** 按风格净化一段成稿文本；参考来源节（如已拼进正文）不参与净化 */
export function sanitizeText(text: string, style: WritingStyle): string {
  const fn = getStyleDef(style).sanitize;
  if (!fn || !text) return text;
  const [body, ...tail] = text.split(SOURCES_HEADING);
  return [fn(body), ...tail].join(SOURCES_HEADING);
}

type Part = string | null | undefined | false;

export interface StyledGenerateParams {
  /** 已构造好的模型（getLlmModel / getFlashModel 的返回值） */
  model: Parameters<typeof generateObject>[0]["model"];
  /** 结构化输出 schema（jsonSchema 的返回值），按平台/风格选好再传入 */
  schema: ReturnType<typeof jsonSchema>;
  /** system 零件，空值会被过滤后用空行拼接 */
  system: Part[];
  /** prompt 零件；finalCheck 由本函数追加到最末（模型对末尾位置注意力最强） */
  prompt: Part[];
  /** 请求的风格 + 目标平台：内部换算成该平台实际生效的风格 */
  style: WritingStyle;
  platform: Platform;
  temperature?: number;
  /**
   * finalCheck 是面向「整篇成稿」的逐条自查清单，标题这类短输出场景注入反而添乱，
   * 传 false 关掉（净化仍然生效）。
   */
  withFinalCheck?: boolean;
  /** 输出对象里要净化的字段（模型写的自然语言标题/正文），默认 title + content */
  sanitizeFields?: string[];
}

// 出正文调用追加的输出契约（钉在 prompt 最末，模型对末尾注意力最强）。
// 背景：DeepSeek 等模型对 generateObject 的 JSON schema 遵守不稳定——当 system 很长且含
// 「四阶段写作流程」的阶段字段名（angle/persona/research/draft/final_output）或平台名（wechat）
// 这些竞争性结构线索时，模型经常把正文塞进这些别的键里，AI SDK 又不严格校验，
// 结果顶层 content 为空、静默产出空稿（线上「正文为空/0-1 失败」的真凶）。
// 这段契约与下面的 salvageContent 兜底是一套组合拳：契约降低跑偏概率，兜底负责跑偏了也能救回。
const DRAFT_OUTPUT_CONTRACT =
  "## 输出格式（最高优先级，凌驾前面所有说明）\n" +
  "严格只按前面 schema 要求的键输出 JSON 对象。**成稿正文全文必须完整放进 `content` 字段，绝不允许为空。**\n" +
  "「四阶段写作流程」只是你的内部思考步骤——**绝不可**把 angle / persona / research / draft / final_output 或平台名（如 wechat）当作输出键。";

// 正文可能被模型错放的候选键（按优先级），salvageContent 依次查找
const CONTENT_ALIAS_KEYS = ["content", "final_output", "draft", "正文", "成稿", "body", "article", "text"];
const TITLE_ALIAS_KEYS = ["title", "标题", "heading"];

// 从（可能不合 schema 的）模型对象里把正文与标题救回来。
// content：先查别名键，再退回「对象里最长的那个字符串值」（覆盖 { wechat: "全文" } 这类平台名键）。
// title：查别名键；缺了就从正文首个 Markdown 标题 / 首个非空行抽取。
function salvageContent(obj: Record<string, unknown>): { content: string; title: string } {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  let content = "";
  for (const k of CONTENT_ALIAS_KEYS) {
    if (str(obj[k]).trim()) {
      content = str(obj[k]);
      break;
    }
  }
  if (!content.trim()) {
    let longest = "";
    for (const v of Object.values(obj)) {
      const s = str(v);
      if (s.length > longest.length) longest = s;
    }
    content = longest;
  }
  let title = "";
  for (const k of TITLE_ALIAS_KEYS) {
    if (str(obj[k]).trim()) {
      title = str(obj[k]);
      break;
    }
  }
  if (!title.trim() && content) {
    const heading = content.match(/^#{1,3}\s+(.+)$/m)?.[1];
    const firstLine = content.split("\n").find((l) => l.trim())?.trim();
    title = (heading ?? firstLine ?? "").replace(/^#+\s*/, "").slice(0, 80);
  }
  return { content: content.trim(), title: title.trim() };
}

/** 收口入口：finalCheck 追加 + 调 generateObject + 对指定输出字段做风格净化 */
export async function styledGenerateObject(
  params: StyledGenerateParams,
): Promise<Record<string, unknown>> {
  const {
    model,
    schema,
    system,
    prompt,
    platform,
    temperature = 0.8,
    withFinalCheck = true,
    sanitizeFields = ["title", "content"],
  } = params;
  const style = effectiveStyle(params.style, platform);
  const def = getStyleDef(style);

  // 出正文的调用（sanitizeFields 含 content）才追加输出契约并启用兜底/失败保护；
  // 标题这类短输出（sanitizeFields=["title"]）不掺和，避免给短输出添乱。
  const isDraftCall = sanitizeFields.includes("content");

  const { object } = await generateObject({
    model,
    schema,
    system: system.filter(Boolean).join("\n\n"),
    prompt: [
      ...prompt,
      withFinalCheck ? def.finalCheck : "",
      isDraftCall ? DRAFT_OUTPUT_CONTRACT : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    temperature,
    // 长文风格 4000-7000 字（≈4200-5000 输出 tokens + JSON 包装）会顶穿部分模型
    // 不传 max_tokens 时的默认输出上限（如 DeepSeek 默认 4K），长文 JSON 被截断后
    // 整篇解析失败。显式给到 8192（各家文本模型普遍支持的上限），短输出场景无副作用。
    maxOutputTokens: 8192,
  });

  const out = { ...(object as Record<string, unknown>) };

  // 出正文兜底：模型没把正文放进 content（错放进 final_output / draft / 平台名键等）时，
  // 从别名键或最长字符串值救回正文与标题，避免静默产出空稿。
  // title 单独兜底：即便 content 正常，模型也常把标题内嵌成正文首个 ## 而把 title 字段留空，
  // 这里顺手从正文首个标题补上，省得下游都拿到空标题。
  if (isDraftCall && (!String(out.content ?? "").trim() || !String(out.title ?? "").trim())) {
    const salvaged = salvageContent(out);
    if (!String(out.content ?? "").trim()) out.content = salvaged.content;
    if (!String(out.title ?? "").trim()) out.title = salvaged.title;
  }
  // 救不回来（对象里根本没有可用正文）才失败——把「静默空稿」变成调用方能捕获、前端能重试的真错误
  if (isDraftCall && !String(out.content ?? "").trim()) {
    throw new Error("模型未产出有效正文（generateObject 返回的对象里找不到正文内容，通常是模型没按 JSON schema 输出）");
  }
  for (const field of sanitizeFields) {
    if (typeof out[field] === "string") {
      // 认知反转句净化（「不是A而是B」族）只对长正文做：标题/摘要这类短输出
      // 命中即是唯一核心转折，属于放行范围，跑一遍纯浪费调用。
      // 顺序敏感：先句式改写再词表净化——改写模型可能引入「本质上」这类禁用词，
      // 反过来跑就洗不掉了。
      if ((out[field] as string).length > 300) {
        out[field] = await dePatternText(out[field] as string);
      }
      out[field] = sanitizeText(out[field] as string, style);
    }
  }
  return out;
}
