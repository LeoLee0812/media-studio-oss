import { generateText, jsonSchema } from "ai";
import type { Material, Platform, Topic, DraftMeta } from "./types";
import {
  getAntiAiRules,
  getExpandPipeline,
  getPlatformSpec,
  getStyleSpec,
} from "./prompts";
import { llmConfigured, isSafePublicUrl } from "./config";
import { getFlashModel, getLlmModel } from "./llm";
import { getPrompt } from "./prompt-store";
import { DEFAULT_STYLE, effectiveStyle, getStyleDef, type WritingStyle } from "./styles";
import { SOURCES_HEADING, styledGenerateObject } from "./styled-generate";

// 是否已配置文案引擎（DB 配置或 env 兜底）
export async function llmEnabled(): Promise<boolean> {
  return llmConfigured();
}

// 按生效配置构造文案引擎模型（DeepSeek / 千问，见 lib/llm.ts）
// structured=true 的调用走 generateObject，千问 max 会自动降级 plus 以保证 JSON 遵循
async function getModel(opts: { structured?: boolean } = {}) {
  return getLlmModel(opts);
}

// 服务端抓取第一手原文：自报 UA、剥 HTML、截 8k 字。
// 入口先做 SSRF 校验：url 来自素材库/用户输入，服务端盲抓内网地址会变成探测跳板。
export async function fetchOriginal(url: string): Promise<string | null> {
  if (!isSafePublicUrl(url)) return null;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": process.env.SYNC_UA || "media-studio-sync/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 8000);
  } catch {
    return null;
  }
}

// ===== 正文里的链接回溯（洗稿路径用）=====
// 从粘贴的原文里挖出链接，服务端抓回内容当调研素材——大模型 API 本身不联网，
// 原文里的链接对它只是字符串，想让它「知道」链接内容只能这里先抓回来喂进提示词。

// 提取文本里的 http(s) 链接：去重、剔除内网地址（SSRF）、最多取前 3 条
export function extractUrls(text: string, max = 3): string[] {
  const found = text.match(/https?:\/\/[^\s一-鿿<>"')\]，。；：]+/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of found) {
    const url = raw.replace(/[.,;:!?]+$/, ""); // 剥掉句尾标点
    if (seen.has(url) || !isSafePublicUrl(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

// Tavily Extract 兜底：x.com 这类要 JS 渲染的页面，裸 fetch 只能拿到壳，Tavily 能出正文。
// key 走 env TAVILY_API_KEY（免费额度约 1000 次/月），没配就跳过兜底
async function tavilyExtract(url: string): Promise<string | null> {
  const key = process.env.TAVILY_API_KEY ?? "";
  if (!key) return null;
  try {
    const res = await fetch("https://api.tavily.com/extract", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ urls: [url] }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw: string = data?.results?.[0]?.raw_content ?? "";
    return raw ? raw.replace(/\s+/g, " ").trim().slice(0, 8000) : null;
  } catch {
    return null;
  }
}

// 逐条抓取链接内容：先裸 fetch（免费），拿不到或太短（导航壳）再上 Tavily。
// 各链接并行抓（串行最坏 3×45s，会把洗稿总时长顶穿 Vercel 300s 上限）。
// 返回成功的 sources 和失败的 failed（调用方拼进 warnings 告诉用户哪条没抓到）
export async function fetchLinkSources(
  urls: string[],
): Promise<{ sources: { url: string; text: string }[]; failed: string[] }> {
  const results = await Promise.all(
    urls.map(async (url) => {
      let text = await fetchOriginal(url);
      if (!text || text.length < 300) {
        text = (await tavilyExtract(url)) ?? text;
      }
      return { url, text };
    }),
  );
  const sources: { url: string; text: string }[] = [];
  const failed: string[] = [];
  for (const r of results) {
    if (r.text && r.text.length >= 100) sources.push({ url: r.url, text: r.text });
    else failed.push(r.url);
  }
  return { sources, failed };
}

// 把素材拼成上下文文本
function materialsContext(materials: Material[]): string {
  return materials
    .map((m, i) => {
      const parts = [`【素材${i + 1}】${m.title ?? ""}`];
      if (m.title_en) parts.push(`原标题：${m.title_en}`);
      if (m.url) parts.push(`原文链接：${m.url}`);
      if (m.summary) parts.push(`摘要：${m.summary}`);
      if (m.content) parts.push(`正文：${m.content.slice(0, 6000)}`);
      if (m.tags?.length) parts.push(`标签：${m.tags.join("、")}`);
      return parts.join("\n");
    })
    .join("\n\n");
}

// 组装人设段：只来自选题级 persona 字段（选题/洗稿页手填的自由文本），为空则不注入
function personaSystem(topicPersona: string | null | undefined): string {
  const persona = (topicPersona ?? "").trim();
  if (!persona) return "";
  return (
    "## 人设背景（仅供把握视角与语气，不要在稿件里刻意强调或复述身份，除非附加指令要求）\n" +
    persona
  );
}

// 公众号正文的默认字数/排版约束。风格可以整体替换它（见 lib/styles.ts 的 wechatContentHint）——
// schema 的 description 是模型最后看到的硬约束，不跟着风格走的话会把文风拽回默认调性。
const WECHAT_CONTENT_HINT = "markdown 长文 1500-3000字，小标题分节";

// 各平台结构化 schema（当前只有公众号）
const SCHEMAS: Record<Platform, ReturnType<typeof jsonSchema>> = {
  wechat: jsonSchema({
    type: "object",
    properties: {
      title: { type: "string" },
      content: { type: "string", description: WECHAT_CONTENT_HINT },
      sources: { type: "array", items: { type: "string" }, description: "参考来源列表（版权红线，必填）" },
    },
    required: ["title", "content", "sources"],
    additionalProperties: false,
  }),
};

// 生效的 schema：只有公众号的正文约束会随风格变，其余平台直接用默认 schema
function schemaFor(platform: Platform, style: WritingStyle) {
  const hint = getStyleDef(style).wechatContentHint;
  if (platform !== "wechat" || !hint) return SCHEMAS[platform];
  return jsonSchema({
    type: "object",
    properties: {
      title: { type: "string" },
      content: { type: "string", description: hint },
      sources: {
        type: "array",
        items: { type: "string" },
        description: "参考来源列表（版权红线，必填）",
      },
    },
    required: ["title", "content", "sources"],
    additionalProperties: false,
  });
}

// 风格相关的两段 system 素材：风格总纲 + 客观性要求（风格可停用后者）。
// 客观性要求压「我试了试/我感觉」这类主观表述，与「活人感」类风格正面冲突，
// 所以由风格决定注不注入；虚构红线不在此列，任何风格下都注入。
async function styleBlocks(style: WritingStyle, experience?: string) {
  const def = getStyleDef(style);
  const [styleSpec, objectivity] = await Promise.all([
    getStyleSpec(style),
    def.dropObjectivity ? Promise.resolve("") : getPrompt("objectivity_rules"),
  ]);
  // 「真实经历」栏为空 = 用户没给任何真实经历。此时要换掉依赖「亲自下场」的文章原型，
  // 否则模型会为了写像而编经历（见 styles.ts 的 noExperienceHint 注释）。
  // 判定只看独立的经历字段，不看附加指令——附加指令是自由指令，写了不代表给了经历。
  const hasExperience = !!experience?.trim();
  return {
    styleSpec: styleSpec ? "## 写作风格（文风类条款以此为准）\n" + styleSpec : "",
    objectivity,
    noExperience: hasExperience ? "" : (def.noExperienceHint ?? ""),
  };
}

// 「真实经历」prompt 段：唯一允许写进第一人称经历的素材来源
function experienceBlock(experience?: string): string {
  const t = (experience ?? "").trim();
  if (!t) return "";
  return "## 真实经历（用户提供的第一手素材，织进正文；正文里的第一人称经历只许来自这里）\n" + t;
}

export interface GeneratedDraft {
  platform: Platform;
  title: string | null;
  content: string;
  meta: DraftMeta | null;
}

// ===== 调研提炼 =====
// 把 fetchOriginal 抓回的裸网页文本提炼成 expand.md 第②阶段要求的调研笔记结构。
// 失败返回 null，由调用方决定兜底（如退回裸文本截断）。
export async function distillResearch(params: {
  topic: Topic;
  sources: { url: string; text: string }[];
}): Promise<string | null> {
  const { topic, sources } = params;
  if (sources.length === 0) return null;
  try {
    const system = await getPrompt("research_system");
    const prompt = [
      `## 选题\n标题：${topic.title ?? ""}\n切入角度：${topic.angle ?? ""}`,
      "## 抓取到的原文",
      sources
        .map((s) => `【原文出处：${s.url}】\n${s.text.slice(0, 6000)}`)
        .join("\n\n"),
      [
        "请围绕选题角度，把上面原文提炼成如下结构的调研笔记（总共几百字，中文，纯文本）：",
        "- 关键数据/事实：每条注明出处（链接或机构+日期）",
        "- 可引用的原话：注明说话人",
        "- 案例/故事：简述",
        "- 反面观点/争议点：简述",
        "某一项原文里没有就写「无」，不要硬凑。",
      ].join("\n"),
    ].join("\n\n");

    const { text } = await generateText({
      // 提炼是总结活，走 flash 轻量模型（够用且快 3-5 倍）——主引擎切 pro 后
      // 若这里也用 pro，洗稿全链路（抓链接+提炼+写正文+收尾）会顶穿 Vercel 300s 上限
      model: await getFlashModel(),
      system,
      prompt,
      temperature: 0.3,
    });
    const out = text.trim();
    return out ? out : null;
  } catch {
    return null;
  }
}

// ===== 单步生成（唯一出稿路径，2026-07-14 起）=====
// 母稿两步制已砍：主流程只出公众号一个平台，两步制的「事实不漂移、素材只烧一次」收益不存在了，
// 却让每篇文章多烧一整篇母稿的输出 tokens（长文风格下母稿 2500-4000 字）。
// 单步直接走 expand.md 四阶段：素材+调研进来，公众号成稿出去。
export async function generateForPlatform(params: {
  topic: Topic;
  materials: Material[];
  platform: Platform;
  research?: string;
  extra?: string;
  experience?: string;
  style?: WritingStyle;
}): Promise<GeneratedDraft> {
  const { topic, materials, platform, research, extra, experience } = params;
  // 该平台实际生效的风格：风格声明了平台白名单时，白名单外的平台退回默认
  const style = effectiveStyle(params.style ?? DEFAULT_STYLE, platform);
  const [antiAi, pipeline, platformSpec, redLine, blocks] =
    await Promise.all([
      getAntiAiRules(),
      getExpandPipeline(),
      getPlatformSpec(platform, style),
      getPrompt("fabrication_red_line"),
      styleBlocks(style, experience),
    ]);

  // 人设默认为空（只认选题级 persona 自由文本）；有人设时也只作视角参考，不在每篇稿件里强调身份。
  // finalCheck 的追加和成稿净化由 styledGenerateObject 统一负责（收口，见 lib/styled-generate.ts）
  const object = await styledGenerateObject({
    model: await getModel({ structured: true }),
    schema: schemaFor(platform, style),
    style,
    platform,
    system: [
      "你是一名资深自媒体写手。素材是起点不是成品，必须扩写深化，绝不原样搬运。",
      personaSystem(topic.persona),
      "## 四阶段写作流程\n" + pipeline,
      blocks.styleSpec,
      "## 反 AI 写作铁律（产出后逐条自查）\n" + antiAi,
      redLine,
      blocks.objectivity,
      blocks.noExperience,
      "## 目标平台规范\n" + platformSpec,
      "严格按要求的 JSON 结构输出，不要输出任何多余解释。中文成稿。",
    ],
    prompt: [
      `## 选题\n标题：${topic.title ?? ""}\n切入角度：${topic.angle ?? ""}`,
      research ? `## 调研 / 原文回溯要点（含出处）\n${research}` : "",
      `## 素材\n${materialsContext(materials)}`,
      experienceBlock(experience),
      extra ? `## 附加指令\n${extra}` : "",
      `请据此产出【${platform}】平台的稿件。`,
    ],
  });

  return withStyle(normalize(platform, object), style);
}

// 稿件记下自己实际生效的风格：稿件页的 AI 修改/AI 标题据 meta.style 沿用同一风格，
// 不会一改就漂回默认调性。写在这里（而不是各 API 路由）保证记录的是「生效风格」——
// 请求风格在该平台不适用而退回默认时，记录的也是默认。
function withStyle(draft: GeneratedDraft, style: WritingStyle): GeneratedDraft {
  return { ...draft, meta: { ...(draft.meta ?? {}), style } };
}

function normalize(
  platform: Platform,
  obj: Record<string, unknown>,
): GeneratedDraft {
  // 当前只有公众号：sources 追加到正文末尾的参考来源段
  const sources = (obj.sources as string[]) ?? [];
  let content = String(obj.content ?? "");
  if (sources.length) {
    content += SOURCES_HEADING + "\n" + sources.map((s) => `- ${s}`).join("\n");
  }
  return {
    platform,
    title: String(obj.title ?? ""),
    content,
    meta: { sources },
  };
}
