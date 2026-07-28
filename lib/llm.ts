import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { resolveLlmConfig, resolveTranslateConfig, resolveFlashConfig } from "./config";
import { LLM_PROVIDERS, type LlmProvider } from "./llm-providers";

// ===== 文案引擎模型工厂 =====
// 所有走文案引擎的 LLM 调用（母稿/派生/角度建议/调研提炼/AI 修改/封面提示词）统一从这里取模型，
// 由设置页的 llmProvider 决定实际打到 DeepSeek 官方 API、千问 DashScope、Kimi（Moonshot），
// 还是任意 OpenAI 兼容的聚合中转站（relay，Base URL 可配）。
//
// 有些模型接了 json_schema 却不遵循（千问 max 返回自造字段、Kimi k2.5/k2.6 返回裸数字），
// 结构化出稿会整篇丢失。因此 generateObject 类调用（structured: true）按注册表的
// structuredFallback 自动换成同家可用的模型；纯文本生成（generateText）仍用用户配置的模型。
function effectiveModel(provider: LlmProvider, model: string, structured?: boolean): string {
  if (!structured) return model;
  return LLM_PROVIDERS[provider].structuredFallback(model) ?? model;
}

// 按 provider 造模型实例。DeepSeek 用官方 SDK，其余走各家的 OpenAI 兼容接口。
// baseUrl 来自 resolve* 的生效值：deepseek/qwen/kimi 固定官方地址，
// relay（聚合中转）可被设置页 / env 覆盖成任意 OpenAI 兼容端点。
function buildModel(provider: LlmProvider, apiKey: string, model: string, baseUrl?: string): LanguageModel {
  if (provider === "deepseek") return createDeepSeek({ apiKey })(model);
  const meta = LLM_PROVIDERS[provider];
  const client = createOpenAICompatible({
    name: meta.id,
    apiKey,
    baseURL: baseUrl || meta.baseUrl,
    // 必开：否则 generateObject 不下发 response_format，模型会返回裸文本导致解析为空
    supportsStructuredOutputs: true,
  });
  return client(model);
}

export async function getLlmModel(opts: { structured?: boolean } = {}): Promise<LanguageModel> {
  const { provider, apiKey, model, baseUrl } = await resolveLlmConfig();
  return buildModel(provider, apiKey, effectiveModel(provider, model, opts.structured), baseUrl);
}

// 素材翻译模型：与文案引擎独立配置（默认经聚合中转站调 deepseek-v4-flash）。
// 关了开关或所选引擎没 key 时返回 null，调用方据此跳过翻译（英文原样入库，不算失败）。
export async function getTranslateModel(): Promise<LanguageModel | null> {
  const t = await resolveTranslateConfig();
  if (!t.enabled || !t.apiKey) return null;
  return buildModel(t.provider, t.apiKey, t.model, t.baseUrl);
}

// 轻量快速模型：标题重写 / 小红书高亮 / 段落 emoji 这类小任务用（延迟低、成本低）。
// 2026-07-18 起不再写死 DeepSeek 官方——走设置页「轻量任务引擎」独立配置（默认经聚合中转站调
// deepseek-v4-flash），所选引擎没 key 时退回当前文案引擎，保证功能不因此挂掉。
export async function getFlashModel(opts: { structured?: boolean } = {}): Promise<LanguageModel> {
  const f = await resolveFlashConfig();
  if (f.apiKey) return buildModel(f.provider, f.apiKey, f.model, f.baseUrl);
  return getLlmModel(opts);
}
