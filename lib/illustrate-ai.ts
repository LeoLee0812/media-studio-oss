import { generateObject, jsonSchema } from "ai";
import { getLlmModel } from "./llm";
import { getPrompt } from "./prompt-store";
import { resolveImageConfig } from "./config";
import { baseSizeForRatio } from "./cover";
import { putBlob } from "./blob";
import {
  AI_ILLUSTRATE_STYLES,
  MAX_AI_ILLUSTRATIONS,
  resolveAiIllustrateStyle,
} from "./illustrate-styles";

// ===== AI 生成知识图解正文配图（并存链路，不搜图）=====
// 与 lib/illustrate-server.ts（图库搜图）并存的第二条正文配图链路：
// ① 把文章拆成「认知锚点」（方法论见 prompts/system/illustrate/anchor-system.md，
//    搬自 cc2image 的 article_breakdown.md：优先抓核心判断/认知断点/输入输出/分流/
//    对比/承接/常见坑，而不是「均匀分布给视觉呼吸感」）
// ② 每个锚点按所选风格套一段确定性模板（搬自 cc2image prompt_schema.py 的
//    render_handdrawn_body / render_quirky_doodle_body，改写成中文），拼出最终绘图提示词
// ③ 调同一套生图中转端点的 gpt-image-2（/images/generations，写法参考 lib/cover.ts 的
//    generateCoverImage）逐张生图，返回 base64
// 成本提醒：一张图真金白银，MAX_AI_ILLUSTRATIONS 是硬上限。触发方式有两条：稿件页手动点
// 「AI 生成配图」，或设置页把「文内配图默认方式」预设成 AI 生图后由生文流水线自动调用。

// 风格常量搬去 lib/illustrate-styles.ts（纯数据，客户端也 import），这里原样转出保持旧引用可用
export { AI_ILLUSTRATE_STYLES, MAX_AI_ILLUSTRATIONS, resolveAiIllustrateStyle };
export type { AiIllustrateStyle } from "./illustrate-styles";

/** 图注 → 文件名安全片段：只留中英文与数字，截前 12 个字符（与 lib/illustrate.ts 的图库配图同规则） */
function captionSlug(caption: string): string {
  return caption.replace(/[^一-龥a-zA-Z0-9]/g, "").slice(0, 12);
}

// 第 index 张（0 起）AI 配图的本地文件名；单独命名（AI配图 前缀 + .png）与图库配图（配图 前缀 + .jpg）区分，
// 避免下载到同一目录时互相覆盖
export function aiIllustrationFilename(index: number, caption: string): string {
  const slug = captionSlug(caption) || "图片";
  return `AI配图${index + 1}-${slug}.png`;
}

// ---- ① 认知锚点选点（generateObject 结构化输出）----

const ANCHOR_SCHEMA = jsonSchema({
  type: "object",
  properties: {
    images: {
      type: "array",
      description: "认知锚点插图点，按出现顺序，宁少勿滥",
      items: {
        type: "object",
        properties: {
          after: { type: "integer", description: "插在编号为 after 的段落之后" },
          coreIdea: { type: "string", description: "这张图要让读者看懂的核心判断，一句话" },
          visualAnchor: { type: "string", description: "认知锚点类型：核心判断/认知断点/输入输出闭环/分流判断/前后对比/承接路径/常见坑" },
          elements: { type: "string", description: "画面必须出现的 3-5 个具体物件，中文顿号分隔" },
          characterAction: { type: "string", description: "画面里角色正在做的动作，一个动词短语" },
          caption: { type: "string", description: "展示给读者的中文图注，8-20 字" },
        },
        required: ["after", "coreIdea", "visualAnchor", "elements", "characterAction", "caption"],
        additionalProperties: false,
      },
    },
  },
  required: ["images"],
  additionalProperties: false,
});

export interface AnchorPlan {
  after: number;
  coreIdea: string;
  visualAnchor: string;
  elements: string;
  characterAction: string;
  caption: string;
}

// 拆文章为认知锚点插图点；maxImages 默认吃满上限，调用方可传更小值进一步收紧成本
export async function planAiIllustrationAnchors(params: {
  title: string;
  content: string;
  maxImages?: number;
}): Promise<AnchorPlan[]> {
  const { title, content } = params;
  const maxImages = Math.max(1, Math.min(params.maxImages ?? MAX_AI_ILLUSTRATIONS, MAX_AI_ILLUSTRATIONS));
  if (!content.trim()) throw new Error("正文为空，无从配图");

  // 与 illustrate-server.ts 相同的编号切段规则，保持 after 的语义一致
  const blocks = content.split(/\n{2,}/);
  const numbered = blocks
    .map((b, i) => `[${i + 1}] ${b.replace(/\n/g, " ").slice(0, 120)}`)
    .join("\n");

  const system = await getPrompt("illustrate_ai_anchor_system");
  const prompt = [
    `文章标题：${title || "（无标题）"}`,
    `正文段落（共 ${blocks.length} 段，每段只截取了开头做定位用）：`,
    numbered,
    `请给出最多 ${maxImages} 个认知锚点插图点，宁少勿滥。after 必须是上面出现过的段落编号，不能是最后一段。`,
  ].join("\n\n");

  const { object } = await generateObject({
    model: await getLlmModel({ structured: true }),
    schema: ANCHOR_SCHEMA,
    system,
    prompt,
    temperature: 0.6,
  });
  // 顶层字段名容错：与 illustrate-server.ts 同款问题，聚合中转对 json_schema 字段名约束不严
  const raw = object as Record<string, unknown>;
  const rawList = Array.isArray(raw.images)
    ? raw.images
    : ((Object.values(raw).find(Array.isArray) as unknown[]) ?? []);

  let planned = (rawList as Partial<AnchorPlan>[])
    .map((p) => ({ ...p, after: Number(p.after) }))
    .filter(
      (p): p is AnchorPlan =>
        Number.isInteger(p.after) &&
        p.after >= 1 &&
        p.after < blocks.length &&
        typeof p.coreIdea === "string" &&
        p.coreIdea.trim() !== "" &&
        typeof p.caption === "string" &&
        p.caption.trim() !== "",
    )
    .map((p) => ({
      after: p.after,
      coreIdea: p.coreIdea.trim(),
      visualAnchor: (p.visualAnchor ?? "").trim() || "核心判断",
      elements: (p.elements ?? "").trim(),
      characterAction: (p.characterAction ?? "").trim(),
      caption: p.caption.trim(),
    }))
    .slice(0, maxImages);

  if (planned.length === 0) {
    console.error("[illustrate-ai] 模型认知锚点全部无效，原始返回：", JSON.stringify(object).slice(0, 800));
    throw new Error("AI 没有找到合适的认知锚点");
  }

  // 同一段落后只保留一个锚点，按位置排序（与图库配图链路同规则）
  const seen = new Set<number>();
  planned = planned
    .filter((p) => (seen.has(p.after) ? false : (seen.add(p.after), true)))
    .sort((a, b) => a.after - b.after);

  return planned;
}

// ---- ② 按风格拼确定性绘图提示词（搬自 cc2image render_xxx_body，改写成中文）----

// 手绘知识风：暖白纸感 + 圆角卡片图解 + 极简小人 + 底部判断句
function buildHanddrawnBodyPrompt(params: {
  title: string;
  anchor: AnchorPlan;
  styleAnchorText: string;
}): string {
  const { title, anchor, styleAnchorText } = params;
  return [
    "请生成一张中文文章正文配图，不是封面图。",
    `主题是「${title || "（无标题）"}」。画面为横版 16:9 构图，暖白色纸张背景，轻微纸感纹理，整体干净、克制、精致、有大量留白。`,
    `这张图只表达一个认知锚点（${anchor.visualAnchor}）：「${anchor.coreIdea}」，不要把多个观点塞进同一张图。`,
    `画面中间绘制一套图解来承载这个判断，核心元素包括：「${anchor.elements || anchor.coreIdea}」。元素使用低饱和浅色圆角卡片、便签、框图或标签承载，元素之间用黑灰色细线手绘箭头连接。主体图解不要过大，四周保留明显留白。`,
    `画面一角画一个极简抽象小人，细线条，成人感，正在「${anchor.characterAction || "观察这套图解"}」。`,
    `画面底部用轻微手写小字写一句中文图注：「${anchor.caption}」。`,
    styleAnchorText,
  ]
    .filter(Boolean)
    .join("\n");
}

// 怪诞小人风：小黑角色承担核心动作 + 橙/红/蓝三色标注体系
function buildQuirkyDoodleBodyPrompt(params: {
  title: string;
  anchor: AnchorPlan;
  styleAnchorText: string;
}): string {
  const { title, anchor, styleAnchorText } = params;
  return [
    `这是一张独立的 16:9 横版中文文章配图，主题是「${title || "（无标题）"}」。画面必须是纯白背景、大量留白、黑色细线手绘，整体像轻松怪诞的产品工作流草图，而不是 PPT 或正式流程图。`,
    `这张图只表达一个认知锚点（${anchor.visualAnchor}）：「${anchor.coreIdea}」，不要把多个段落或多个观点塞进同一张图。`,
    `版式不固定，根据内容动作自行选择结构（Workflow / 系统局部 / 前后对比 / 概念隐喻 / 方法分层等），不要把结构类型文字写在画面上。`,
    `画面中必须有一个怪诞小黑角色，正在「${anchor.characterAction || "执行这个判断对应的动作"}」，小黑必须承担核心动作，不是站在角落看图。`,
    `把抽象概念转成一个物理动作或低科技物件，建议元素：「${anchor.elements || anchor.coreIdea}」。画面只保留 3-5 个主要元素。`,
    `中文手写短标注贴合图注含义：「${anchor.caption}」，每处 2-8 个字，最多 5-8 处。`,
    styleAnchorText,
  ]
    .filter(Boolean)
    .join("\n");
}

// 按风格 key 拼最终提示词；styleKey 未知时兜底手绘知识风
export async function buildAiIllustrationPrompt(params: {
  title: string;
  anchor: AnchorPlan;
  styleKey: string;
}): Promise<string> {
  const preset = resolveAiIllustrateStyle(params.styleKey);
  const styleAnchorText = await getPrompt(preset.promptId);
  const args = { title: params.title, anchor: params.anchor, styleAnchorText };
  if (preset.key === "quirky_doodle_character_flow") return buildQuirkyDoodleBodyPrompt(args);
  return buildHanddrawnBodyPrompt(args);
}

// ---- ③ 调生图中转端点的 gpt-image-2 生图（写法参考 lib/cover.ts 的 generateCoverImage）----

// 正文配图默认 16:9；4:3 适合方一点的图解，写法与封面共用 baseSizeForRatio
export async function generateAiIllustrationImage(params: {
  prompt: string;
  ratio?: string;
}): Promise<{ b64: string; size: string }> {
  const ratio = params.ratio ?? "16:9";
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
      prompt: params.prompt,
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
  if (item.url) {
    const img = await fetch(item.url, { signal: AbortSignal.timeout(60_000) });
    if (!img.ok) throw new Error(`拉取图片失败 ${img.status}`);
    const buf = Buffer.from(await img.arrayBuffer());
    return { b64: buf.toString("base64"), size };
  }
  throw new Error("图像接口未返回图片数据");
}

// ---- ④ 上传到对象存储，换成公网直链 ----
// 为什么必须上传，不能把 base64 直接写进正文（2026-07-21 定）：
// ① 公众号编辑器粘贴富文本时会自动抓取外链 <img> 转存到 mmbiz.qpic.cn，**base64 内嵌粘不过去**
//    （结论见 docs/wechat-assets.md，图库配图链路一直好用就是因为 Pexels 本身给的是外链）；
// ② 4 张 base64 图会让 ms_drafts.content 涨到 MB 级，也会让本路由的 JSON 响应超出
//    响应体上限，直接把整条链路打挂。
// 迁到 Cloudflare 后底层是 R2 或 KV（见 lib/blob.ts），直链走自家域名的 /f/ 路由，
// key 本身带随机串，所以同名图注在不同稿件里不会互相覆盖。
export async function uploadIllustrationToBlob(params: {
  b64: string;
  filename: string;
}): Promise<string> {
  const bin = Uint8Array.from(atob(params.b64), (c) => c.charCodeAt(0));
  const blob = await putBlob({
    prefix: "ai-illustrations",
    body: bin,
    contentType: "image/png",
    filename: params.filename,
  });
  return blob.url;
}

// ---- ⑤ 整篇编排（拆锚点 → 逐张生图 → 传 Blob → 插回正文）----
// 稿件页的 /api/drafts/[id]/illustrate-ai 路由与生文流水线（lib/finalize-wechat.ts）
// 共用这一份编排，不许在调用点各抄一遍——两条入口曾经就差在「谁记得写 meta.aiIllustrations」。
// 只做纯计算 + 网络请求，不碰数据库：落库由调用方按各自的并发策略处理。

export interface AiIllustrationResult {
  filename: string;
  caption: string;
  coreIdea: string;
  visualAnchor: string;
  url: string;
  size: string;
}

export async function illustrateArticleWithAi(params: {
  title: string;
  content: string;
  styleKey?: string;
  maxImages?: number;
}): Promise<{ content: string; images: AiIllustrationResult[]; failedCount: number }> {
  const title = params.title ?? "";
  const content = params.content ?? "";
  const styleKey = resolveAiIllustrateStyle(params.styleKey).key;
  const maxImages = Math.max(
    1,
    Math.min(Number(params.maxImages) || MAX_AI_ILLUSTRATIONS, MAX_AI_ILLUSTRATIONS),
  );

  // ① 拆认知锚点（一次 LLM 调用，不产生图像成本）
  const anchors = await planAiIllustrationAnchors({ title, content, maxImages });

  // ② 逐个锚点拼提示词 + 生图（真金白银，严格按顺序执行，不并发放大瞬时成本）
  const blocks = content.split(/\n{2,}/);
  const succeeded: { anchor: AnchorPlan; url: string; size: string; filename: string }[] = [];
  let failedCount = 0;
  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    try {
      const prompt = await buildAiIllustrationPrompt({ title, anchor, styleKey });
      const { b64, size } = await generateAiIllustrationImage({ prompt, ratio: "16:9" });
      // 生完立刻传 Blob 换直链：base64 既粘不进公众号也会撑爆正文和响应体，
      // 全链路只在这一行之内碰 base64，往后一律只传 URL
      const filename = aiIllustrationFilename(i, anchor.caption);
      const url = await uploadIllustrationToBlob({ b64, filename });
      succeeded.push({ anchor, url, size, filename });
    } catch (e) {
      console.error("[illustrate-ai] 单张生图/上传失败：", e);
      failedCount++;
    }
  }
  if (succeeded.length === 0) throw new Error("认知锚点已拆出，但生图全部失败，请重试");

  // ③ 从后往前插入正文（Blob 公网直链，编号不受影响，与图库配图链路同规则）
  const parts = [...blocks];
  for (let i = succeeded.length - 1; i >= 0; i--) {
    const { anchor, url } = succeeded[i];
    parts.splice(anchor.after, 0, `![${anchor.caption}](${url})`);
  }

  return {
    content: parts.join("\n\n"),
    images: succeeded.map((s) => ({
      filename: s.filename,
      caption: s.anchor.caption,
      coreIdea: s.anchor.coreIdea,
      visualAnchor: s.anchor.visualAnchor,
      url: s.url,
      size: s.size,
    })),
    failedCount,
  };
}
