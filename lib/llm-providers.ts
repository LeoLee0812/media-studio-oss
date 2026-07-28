// ===== 文案引擎提供方注册表 =====
// 纯常量模块：不依赖数据库，服务端（config/llm/API 路由）与客户端（设置页卡片）共用同一份事实源。
// 新增一家引擎 = 在这里加一条 meta，设置页按钮、模型拉取、连通性测试、模型工厂全部自动跟上。
//
// 各家都提供 OpenAI 兼容接口，因此：
// - 模型列表统一走 GET {baseUrl}/models
// - 模型调用统一走 createOpenAICompatible（DeepSeek 另有官方 SDK，见 lib/llm.ts）

export type LlmProvider = "deepseek" | "qwen" | "kimi" | "yunwu";

export interface LlmProviderMeta {
  id: LlmProvider;
  /** 设置页引擎切换按钮上的名字 */
  label: string;
  /** OpenAI 兼容接口根地址（不带结尾斜杠） */
  baseUrl: string;
  /** 未配置模型时的兜底默认值 */
  defaultModel: string;
  /** 用量/充值控制台 */
  consoleUrl: string;
  /** API Key 输入框标签里的来源说明 */
  keyLabel: string;
  /** 模型输入框下方的说明文案 */
  modelHint: string;
  /** AppConfig 里存 key 的字段名（deepseek 是历史遗留的非对称命名） */
  keyField: "deepseekApiKey" | "qwenApiKey" | "kimiApiKey" | "yunwuApiKey";
  /** AppConfig 里存模型的字段名 */
  modelField: "llmModel" | "qwenModel" | "kimiModel" | "yunwuModel";
  /** env 兜底变量名 */
  keyEnv: string;
  modelEnv: string;
  /**
   * 从 /models 返回里挑出「能拿来写文案」的模型。
   * 各家 /models 会混进向量/视觉/语音等非对话模型，不过滤会污染下拉框。
   */
  isChatModel: (id: string) => boolean;
  /**
   * 结构化出稿（generateObject）的模型降级。
   *
   * 出稿要模型按 json_schema 返回 JSON（标题/正文/摘要分字段），有些模型在这个约束下
   * **不稳定**——不是完全不支持，而是有相当概率退化：提前收敛成一个裸标量（如 `1.53`，
   * 本身是合法 JSON 但不是 object）、整段跳出约束改写 markdown、或吐上千个空白字符。
   * 一旦发生，整篇稿子就没了。失败时 reasoning_tokens 会飙到正常值的 5~10 倍。
   *
   * 这里给出「该模型结构化不可靠时换成谁」，纯文本生成不受影响（仍用用户选的模型）。
   * 返回 null 表示该模型结构化可靠。
   */
  structuredFallback: (model: string) => string | null;
}

export const LLM_PROVIDERS: Record<LlmProvider, LlmProviderMeta> = {
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-v4-pro",
    consoleUrl: "https://platform.deepseek.com/",
    keyLabel: "API Key（DeepSeek 开放平台，点右侧眼睛可见）",
    modelHint:
      "deepseek-chat 是官方别名（自动指向当时最新的对话模型）；接口现已直接提供 deepseek-v4-pro / deepseek-v4-flash，建议用 deepseek-v4-pro。",
    keyField: "deepseekApiKey",
    modelField: "llmModel",
    keyEnv: "DEEPSEEK_API_KEY",
    modelEnv: "LLM_MODEL",
    // DeepSeek /models 只返回对话模型，全收
    isChatModel: () => true,
    // 2026-07 实测：v4-pro / v4-flash 都严格遵循 json_schema
    structuredFallback: () => null,
  },
  qwen: {
    id: "qwen",
    label: "通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen3.7-max",
    consoleUrl: "https://bailian.console.aliyun.com/",
    keyLabel: "API Key（阿里云百炼 DashScope，点右侧眼睛可见）",
    modelHint: "千问 3.7 系列：qwen3.7-max（旗舰）/ qwen3.7-plus（性价比）。走 DashScope 的 OpenAI 兼容接口。",
    keyField: "qwenApiKey",
    modelField: "qwenModel",
    keyEnv: "QWEN_API_KEY",
    modelEnv: "QWEN_MODEL",
    // 百炼一个 key 通向量/语音/图像/视觉/全模态/重排等全家桶（实测 140 个），只留文本对话系。
    // vl（视觉）/ omni（全模态）/ realtime（实时语音）能出文本但不是写文案用的，一并滤掉。
    isChatModel: (id) =>
      /^(qwen|qwq|deepseek|moonshot|baichuan|chatglm|yi-|llama|abab|farui|ernie)/i.test(id) &&
      !/(embedding|rerank|asr|tts|audio|speech|image|ocr|paraformer|cosyvoice|wanx|omni|realtime|-vl-|^qwen-vl|^qvq)/i.test(
        id,
      ),
    // 2026-07 实测：qwen3.7-max 在 json_schema 下返回自造字段，plus 稳定
    structuredFallback: (m) => (/^qwen3\.7-max/.test(m) ? "qwen3.7-plus" : null),
  },
  kimi: {
    id: "kimi",
    label: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "kimi-k3",
    consoleUrl: "https://platform.moonshot.cn/console/account",
    keyLabel: "API Key（Moonshot 开放平台，点右侧眼睛可见）",
    modelHint: "Kimi 系列：kimi-k3（旗舰，1M 上下文）/ kimi-k2.7-code / moonshot-v1-*。走 Moonshot 的 OpenAI 兼容接口。",
    keyField: "kimiApiKey",
    modelField: "kimiModel",
    keyEnv: "KIMI_API_KEY",
    modelEnv: "KIMI_MODEL",
    // moonshot-v1-* 的 vision-preview 是视觉模型，写文案用不上
    isChatModel: (id) => !/vision/i.test(id),
    // 2026-07 实测：k2.5 / k2.6 这两个思考模型在 json_schema 约束下不稳定——
    // 会退化成裸数字（"1.53"）、markdown 或上千个空白字符，整篇稿子丢光，
    // 且失败时 reasoning_tokens 是正常模型的 5~10 倍（600~1300 vs 54~160）。
    // k2.7-code / k3 / moonshot-v1-* 实测稳定。
    structuredFallback: (m) => (/^kimi-k2\.[56]/.test(m) ? "kimi-k3" : null),
  },
  yunwu: {
    id: "yunwu",
    label: "云雾 API",
    baseUrl: "https://yunwu.ai/v1",
    defaultModel: "deepseek-v4-pro",
    consoleUrl: "https://yunwu.ai/",
    keyLabel: "API Key（yunwu.ai 中转站，点右侧眼睛可见；与生图 key 同账号可通用）",
    modelHint:
      "云雾是聚合中转站，一把 key 通 400+ 模型（DeepSeek / GPT / Claude / Gemini / Qwen / GLM / Grok…）。默认 deepseek-v4-pro；点「获取模型」拉当前可用列表再选。",
    keyField: "yunwuApiKey",
    modelField: "yunwuModel",
    keyEnv: "YUNWU_API_KEY",
    modelEnv: "YUNWU_MODEL",
    // 云雾 /models 是全家桶（2026-07 实测 403 个），生图/音视频/向量全混在一起。
    // 白名单主流文本对话系前缀 + 黑名单多模态/媒体关键词，双保险过滤。
    isChatModel: (id) =>
      /^(deepseek|gpt-|chatgpt|o[134](-|$)|claude|gemini|qwen|qwq|glm|grok|kimi|moonshot|llama|mistral|doubao|ernie|yi-|minimax|hunyuan|step)/i.test(
        id,
      ) &&
      !/(image|dall-e|vision|-vl|audio|voice|speech|tts|asr|whisper|realtime|embedding|rerank|moderation|search|transcribe|video|sora|veo|imagen)/i.test(
        id,
      ),
    // 中转透传底层模型，逐个实测不现实；先视为可靠，出稿翻车再按模型补降级规则
    structuredFallback: () => null,
  },
};

export const LLM_PROVIDER_IDS = Object.keys(LLM_PROVIDERS) as LlmProvider[];

export function isLlmProvider(v: unknown): v is LlmProvider {
  return typeof v === "string" && v in LLM_PROVIDERS;
}

/**
 * 给设置页用：该模型选中后要不要提醒「写稿的其实不是它」。
 * 返回 null 表示所选模型就是实际写稿的模型。
 */
export function structuredNote(provider: LlmProvider, model: string): { fallback: string; text: string } | null {
  const fallback = LLM_PROVIDERS[provider].structuredFallback(model);
  if (!fallback) return null;
  return {
    fallback,
    text: `${model} 在结构化输出下不稳定（会概率性吐出裸数字或 markdown，导致整篇稿子丢失），因此正文、角度建议、AI 改稿这些出稿环节会改用 ${fallback} 来写；${model} 只用于调研提炼这类纯文本环节。`,
  };
}

/** 下拉框选项文字：会降级的模型直接在选项里标出来，选之前就知道 */
export function modelOptionLabel(provider: LlmProvider, model: string): string {
  const fb = LLM_PROVIDERS[provider].structuredFallback(model);
  return fb ? `${model}（不出稿，将由 ${fb} 代写）` : model;
}

/** 脏值/未设置一律退回 deepseek */
export function normalizeLlmProvider(v: unknown): LlmProvider {
  return isLlmProvider(v) ? v : "deepseek";
}
