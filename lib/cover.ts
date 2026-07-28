import { promises as fsp } from "fs";
import path from "path";
import { generateObject, generateText, jsonSchema } from "ai";
import { resolveImageConfig, imageConfigured } from "./config";
import { getLlmModel } from "./llm";
import { getPrompt } from "./prompt-store";
import { COVER_STYLES, resolveCoverStyle } from "./cover-styles";

// ===== 公众号封面图 =====
// 三条链路，稿件页可切换：
// ① 模板直生（该风格有模板参考图时的默认）：不经文案引擎——把该风格的参考封面图
//    连同固定指令（cover_template_instruction）+ 风格定义直接发给 GPT Image 的
//    /images/edits，让图像模型照模板风格自己构思新封面
// ② 锚点直生（该风格没有模板参考图时的默认）：文案引擎先把稿件拆成结构化字段
//    （标题/导语/标签/隐喻/元素），填进通用版式骨架 cover_anchor_layout，再拼上
//    该风格的风格定义 → /images/generations 文生图。风格由文字立起来，不靠参考图。
// ③ 提示词链路（旧）：文案引擎直接写一整段绘图提示词 → 前端审阅/编辑 → 文生图
// 三条路生成后都由前端按目标比例居中裁剪（图像模型只支持固定尺寸，精确比例靠裁剪）
//
// 风格注册表在 lib/cover-styles.ts（纯数据，客户端组件也直接 import，不再两处手抄）
export { COVER_STYLES, COVER_RATIOS, resolveCoverStyle, recommendCoverStyles } from "./cover-styles";
export type { CoverStyle } from "./cover-styles";

export async function imageEnabled(): Promise<boolean> {
  return imageConfigured();
}

// 比例 → 图像模型支持的基础尺寸：横幅 1536x1024、竖幅 1024x1536、方图 1024x1024
export function baseSizeForRatio(ratio: string): string {
  const [w, h] = ratio.split(":").map(Number);
  if (!w || !h) return "1536x1024";
  const r = w / h;
  if (r > 1.05) return "1536x1024";
  if (r < 0.95) return "1024x1536";
  return "1024x1024";
}

// 居中裁剪安全区说明（两条链路生图前都追加到提示词末尾）：
// 图像模型只出三档固定尺寸，精确比例靠前端居中裁剪——不提醒的话模型会把刊头/大字
// 顶满整个画布，裁完就被切头切尾（「封面被截断」的根因）。keep = 裁剪后保留的比例，
// 差距不大（>97%）就不啰嗦，免得白占提示词篇幅。
export function cropSafetyNote(ratio: string): string {
  const size = baseSizeForRatio(ratio);
  const [bw, bh] = size.split("x").map(Number);
  const [rw, rh] = ratio.split(":").map(Number);
  if (!bw || !bh || !rw || !rh) return "";
  const target = rw / rh;
  const base = bw / bh;
  const keep = target > base ? base / target : target / base;
  if (keep > 0.97) return "";
  // 多报 4 个百分点当内边距余量：模型爱把刊头/文字正好贴在报给它的边界线上，
  // 按真实裁剪线报数就会被削掉笔画顶
  const margin = Math.round(((1 - keep) / 2) * 100) + 4;
  const axis = target > base ? "top and bottom" : "left and right";
  const band = target > base ? "horizontal" : "vertical";
  return (
    `CRITICAL FRAMING: the delivered cover is only the central ${band} band of this canvas — ` +
    `the outer ${margin}% on the ${axis} WILL BE CUT OFF. Compose the ENTIRE cover ` +
    `(masthead, headline, subject, decorations) strictly inside that central band, treating it as the full canvas; ` +
    `any bottom-band / margin rules apply within it, not to the raw canvas. ` +
    `Fill the ${axis} ${margin}% bleed margins with a plain continuation of the background only — ` +
    `no text, no subjects, nothing important may touch them.`
  );
}

// 文案引擎生成封面图提示词（模板可在提示词页编辑，返回给前端供用户审阅和编辑）
export async function generateCoverPrompt(params: {
  title: string;
  content: string;
  style: string;
  ratio?: string;
}): Promise<string> {
  const { title, content, style, ratio = "2.35:1" } = params;
  // style 传风格 key；老值或空值回落到默认风格。只有保留了 legacyPromptId 的原生风格
  // 提供这条旧链路，迁移进来的 cc2image 风格一律走锚点直生
  const preset = resolveCoverStyle(style);
  if (!preset.legacyPromptId) {
    throw new Error(`「${preset.label}」没有提示词链路，请用锚点直生`);
  }
  const system = await getPrompt(preset.legacyPromptId);
  const { text } = await generateText({
    model: await getLlmModel(),
    system,
    prompt: [
      `文章标题：${title || "（无标题）"}`,
      `正文摘录：\n${(content || "").slice(0, 1500)}`,
      `目标比例：${ratio}（宽幅横版时提示词里写 cinematic wide banner；竖版/方图相应调整构图描述）`,
    ].join("\n\n"),
    temperature: 0.7,
  });
  return text.trim();
}

// 调中转站生成封面图，返回 base64 PNG（不含 data: 前缀）
export async function generateCoverImage(params: {
  prompt: string;
  ratio: string;
  /** 调用方已经自己拼过裁剪安全区说明（锚点直生就是），别再追加一遍 */
  skipCropNote?: boolean;
}): Promise<{ b64: string; size: string }> {
  const { ratio } = params;
  // 提示词链路同样吃裁剪的亏（文案引擎不知道居中裁剪的存在），生图前统一追加安全区说明
  const note = params.skipCropNote ? "" : cropSafetyNote(ratio);
  const prompt = note ? `${params.prompt}\n\n${note}` : params.prompt;
  const { base, apiKey, model, quality } = await resolveImageConfig();
  const size = baseSizeForRatio(ratio);
  const res = await fetch(`${base}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      size,
      quality,
      n: 1,
    }),
    signal: AbortSignal.timeout(280_000),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`图像接口 ${res.status}：${detail}`);
  }
  const data = await res.json();
  const item = data?.data?.[0] ?? {};
  if (item.b64_json) return { b64: item.b64_json, size };
  // 兼容部分中转返回 url 的情况：服务端拉回来转 base64
  if (item.url) {
    const img = await fetch(item.url, { signal: AbortSignal.timeout(60_000) });
    if (!img.ok) throw new Error(`拉取图片失败 ${img.status}`);
    const buf = Buffer.from(await img.arrayBuffer());
    return { b64: buf.toString("base64"), size };
  }
  throw new Error("图像接口未返回图片数据");
}

// ===== 模板直生（参考图 → /images/edits）=====
// 模板图按风格分目录存放，加图 = 往目录里丢 png/jpg/webp（随代码部署）：
//   prompts/system/cover/templates/<风格key>/*.png
const TEMPLATES_DIR = path.join(process.cwd(), "prompts", "system", "cover", "templates");
const TEMPLATE_EXTS: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};
// 单次最多带 4 张参考图（多了 multipart 体积大、对风格帮助有限）
const MAX_TEMPLATE_IMAGES = 4;

// 某风格的模板图文件列表（文件名排序，超出上限截断）
export async function listTemplateImages(styleKey: string): Promise<string[]> {
  try {
    const dir = path.join(TEMPLATES_DIR, styleKey);
    const files = await fsp.readdir(dir);
    return files
      .filter((f) => TEMPLATE_EXTS[path.extname(f).toLowerCase()])
      .sort()
      .slice(0, MAX_TEMPLATE_IMAGES)
      .map((f) => path.join(dir, f));
  } catch {
    return []; // 目录不存在 = 该风格还没配模板
  }
}

// 各风格的模板图数量（前端据此决定模板直生按钮是否可用）
export async function templateAvailability(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const p of COVER_STYLES) {
    out[p.key] = (await listTemplateImages(p.key)).length;
  }
  return out;
}

// 带模板参考图直接生图：固定指令 + 风格定义 + 标题 + 可选补充要求，图像模型自己构思画面
export async function generateCoverImageFromTemplate(params: {
  title: string;
  style: string;
  ratio: string;
  extra?: string;
}): Promise<{ b64: string; size: string }> {
  const { title, style, ratio, extra } = params;
  const preset = resolveCoverStyle(style);
  const files = await listTemplateImages(preset.key);
  if (!files.length) {
    throw new Error(
      `「${preset.label}」还没有模板参考图——把封面图放进 prompts/system/cover/templates/${preset.key}/ 再部署即可`,
    );
  }
  // 风格定义在这条链路上是「文字缰绳」：参考图给的是版式和质感，模型仍可能顺着参考图
  // 的题材跑偏，把该风格的气质/配色/负面清单再说一遍能明显收敛
  const [instruction, styleDef] = await Promise.all([
    getPrompt("cover_template_instruction"),
    getPrompt(preset.styleId),
  ]);
  const prompt = [
    instruction,
    `STYLE DEFINITION\n${styleDef}`,
    `Headline text to render on the cover (Chinese, verbatim, exactly once): "${title || "无标题"}"`,
    cropSafetyNote(ratio),
    extra?.trim() ? `Additional requirements from the editor: ${extra.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const { base, apiKey, model, quality } = await resolveImageConfig();
  const size = baseSizeForRatio(ratio);
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", prompt);
  form.append("size", size);
  form.append("quality", quality);
  form.append("n", "1");
  for (const file of files) {
    const buf = await fsp.readFile(file);
    const mime = TEMPLATE_EXTS[path.extname(file).toLowerCase()] ?? "image/png";
    form.append("image[]", new Blob([new Uint8Array(buf)], { type: mime }), path.basename(file));
  }

  const res = await fetch(`${base}/images/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` }, // multipart 边界由 fetch 自动生成，不手写 Content-Type
    body: form,
    signal: AbortSignal.timeout(280_000),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`图像接口（模板直生）${res.status}：${detail}`);
  }
  const data = await res.json();
  const item = data?.data?.[0] ?? {};
  if (item.b64_json) return { b64: item.b64_json, size };
  if (item.url) {
    const img = await fetch(item.url, { signal: AbortSignal.timeout(60_000) });
    if (!img.ok) throw new Error(`拉取图片失败 ${img.status}`);
    const buf = Buffer.from(await img.arrayBuffer());
    return { b64: buf.toString("base64"), size };
  }
  throw new Error("图像接口（模板直生）未返回图片数据");
}

// ===== 锚点直生（无参考图，靠文字把风格立起来）=====
// 迁移自 izscc/cc2image 的做法：一套风格 = 一段「风格定义」（气质/材质/配色/构图特色 +
// 负面清单），配一份通用版式骨架，字段由文案引擎拆解后填入。没有模板图也能稳定出风格，
// 以后往 templates/<key>/ 丢了参考图，同一套风格自动升级成模板直生，风格定义不用改。

/** 封面字段：文案引擎只填这五项，版式由骨架固定，避免每次生成的提示词结构都不一样 */
export interface CoverSpec {
  headline: string;
  deck: string;
  tags: string[];
  metaphor: string;
  elements: string;
}

const COVER_SPEC_SCHEMA = jsonSchema({
  type: "object",
  properties: {
    headline: { type: "string", description: "封面主标题，6-14 个中文字" },
    deck: { type: "string", description: "标题下方导语，18-30 字" },
    tags: {
      type: "array",
      description: "2-3 个小标签，每个不超过 4 个中文字",
      items: { type: "string" },
    },
    metaphor: { type: "string", description: "核心视觉隐喻，一句中文，必须具体可画" },
    elements: { type: "string", description: "画面补充元素，中文逗号分隔的 3-6 项具体物件" },
  },
  required: ["headline", "deck", "tags", "metaphor", "elements"],
  additionalProperties: false,
});

/** 让文案引擎把稿件拆成封面字段（风格定义一并给它，画面取向才跟得上风格） */
export async function generateCoverSpec(params: {
  title: string;
  content: string;
  style: string;
}): Promise<CoverSpec> {
  const preset = resolveCoverStyle(params.style);
  const [system, styleDef] = await Promise.all([
    getPrompt("cover_spec_system"),
    getPrompt(preset.styleId),
  ]);
  const { object } = await generateObject({
    model: await getLlmModel(),
    schema: COVER_SPEC_SCHEMA,
    system,
    prompt: [
      `本次封面风格：${preset.label}`,
      `风格说明：\n${styleDef}`,
      `文章标题：${params.title || "（无标题）"}`,
      `正文摘录：\n${(params.content || "").slice(0, 1500)}`,
    ].join("\n\n"),
    temperature: 0.7,
  });
  const spec = object as CoverSpec;
  // 模型偶尔把 tags 吐成一个长字符串，兜一下，别让占位符里出现 undefined
  return {
    headline: (spec.headline || params.title || "无标题").trim(),
    deck: (spec.deck || "").trim(),
    tags: Array.isArray(spec.tags) ? spec.tags.filter(Boolean).slice(0, 3) : [],
    metaphor: (spec.metaphor || "").trim(),
    elements: (spec.elements || "").trim(),
  };
}

/** 把字段填进版式骨架的 {{占位符}} */
function fillLayout(layout: string, spec: CoverSpec): string {
  const map: Record<string, string> = {
    headline: spec.headline,
    deck: spec.deck || spec.headline,
    tags: spec.tags.length ? spec.tags.map((t) => `「${t}」`).join("、") : "（无，省略标签区）",
    metaphor: spec.metaphor || "与标题直接相关的具体画面主体",
    elements: spec.elements || "与主体呼应的少量细节元素",
  };
  return layout.replace(/\{\{(\w+)\}\}/g, (raw, key: string) => map[key] ?? raw);
}

/** 锚点直生：版式骨架（填入字段）+ 风格定义 + 裁剪安全区 → /images/generations */
export async function generateCoverImageFromAnchor(params: {
  title: string;
  content?: string;
  style: string;
  ratio: string;
  extra?: string;
  /** 已经拆好的字段（前端预览过就直接传，省一次文案引擎调用） */
  spec?: CoverSpec;
}): Promise<{ b64: string; size: string; spec: CoverSpec }> {
  const { title, content = "", style, ratio, extra } = params;
  const preset = resolveCoverStyle(style);
  const spec = params.spec ?? (await generateCoverSpec({ title, content, style }));
  const [layout, styleDef] = await Promise.all([
    getPrompt("cover_anchor_layout"),
    getPrompt(preset.styleId),
  ]);
  const prompt = [
    fillLayout(layout, spec),
    styleDef,
    cropSafetyNote(ratio),
    extra?.trim() ? `Additional requirements from the editor: ${extra.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const { b64, size } = await generateCoverImage({ prompt, ratio, skipCropNote: true });
  return { b64, size, spec };
}
