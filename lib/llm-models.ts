import { LLM_PROVIDERS, type LlmProvider } from "./llm-providers";

// ===== 各家公开模型列表拉取 =====
// 各家（DeepSeek / 百炼 DashScope / Moonshot / 聚合中转站）都实现了 OpenAI 兼容的 GET /models，
// 一把 key 通常能调多个模型，所以设置页提供「获取模型」按钮实时拉当前可用的模型再下拉选。
// 同一个请求也是最轻的鉴权探测，因此「测试连接」复用它（见 app/api/config/test/route.ts）。

const TIMEOUT_MS = 15000;

export interface ModelsResult {
  ok: boolean;
  /** 过滤+排序后的对话模型 id */
  models: string[];
  /** 失败时的错误原文（已截断） */
  error?: string;
}

// 各家 /models 的 data[].id 形态一致，但字段外层偶有差异，这里只认标准形态
function extractIds(json: unknown): string[] {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data
    .map((m) => (m && typeof m === "object" ? (m as { id?: unknown }).id : null))
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

// baseUrl 可选：relay（聚合中转）引擎的生效端点由调用方经 resolveProviderConfig 解析后传入，
// 不传则回落注册表默认地址（deepseek/qwen/kimi 三家固定官方地址，传不传都一样）。
export async function fetchProviderModels(
  provider: LlmProvider,
  apiKey: string,
  baseUrl?: string,
): Promise<ModelsResult> {
  const meta = LLM_PROVIDERS[provider];
  try {
    const res = await fetch(`${(baseUrl || meta.baseUrl).replace(/\/+$/, "")}/models`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 300);
      return { ok: false, models: [], error: `HTTP ${res.status}${text ? ` ${text}` : ""}` };
    }
    const ids = extractIds(await res.json().catch(() => null));
    // 过滤掉向量/语音/视觉等非文案模型，再按字典序稳定排序，避免各家返回顺序随机导致下拉跳动
    const models = ids.filter((id) => meta.isChatModel(id)).sort((a, b) => a.localeCompare(b));
    return { ok: true, models };
  } catch (e) {
    // 超时/网络错误：原文透传，方便排查
    return { ok: false, models: [], error: e instanceof Error ? e.message : String(e) };
  }
}
