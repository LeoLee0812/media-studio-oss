import { getSyncState, setSyncState } from "./queries";
import { normalizeStyle, type WritingStyle } from "./styles";
import { LLM_PROVIDERS, isLlmProvider, type LlmProvider } from "./llm-providers";
import {
  MAX_AI_ILLUSTRATIONS,
  normalizeIllustrateMode,
  resolveAiIllustrateStyle,
  type IllustrateMode,
} from "./illustrate-styles";
import { resolveCoverStyle, type CoverStyle } from "./cover-styles";

// ===== 运行时配置中心 =====
// API 配置（DeepSeek 文案引擎 + 生图中转）统一在设置页管理，存 ms_sync_state 的 app_config 键。
// 解析优先级：数据库配置 > 环境变量 > 内置默认。这样 env 仍可作为初始/兜底，同时支持网页热改。

const CONFIG_KEY = "app_config";

// RSS 订阅源配置：url 必填，pillar 决定采进来的素材归哪个板块（自由命名的分类字符串）
export interface RssFeedConfig {
  url: string;
  pillar: string;
  label?: string; // 备注名，仅展示用
}

// 文案引擎提供方定义已收口到 lib/llm-providers.ts（客户端也要用，不能带 db 依赖）；
// 这里再导出一次，保持既有 import 路径不变。
export type { LlmProvider };

export interface AppConfig {
  // 写作风格默认值（选题页/洗稿页的初始选中项，可逐篇改；默认 default）
  writingStyle?: WritingStyle;
  // 文案引擎提供方（默认 deepseek）
  llmProvider?: LlmProvider;
  // DeepSeek 文案引擎
  deepseekApiKey?: string;
  llmModel?: string;
  // 通义千问（阿里云百炼 DashScope）
  qwenApiKey?: string;
  qwenModel?: string;
  // Kimi（Moonshot 开放平台）
  kimiApiKey?: string;
  kimiModel?: string;
  // 聚合中转站（任意 OpenAI 兼容端点，一把 key 通多家模型；默认示例 yunwu.ai，与本项目无利益关系）
  relayApiKey?: string;
  relayModel?: string;
  // 聚合中转站 Base URL（可指向自建 OneAPI / New API、OpenRouter 等任意 OpenAI 兼容端点；空 = 用默认示例）
  relayBaseUrl?: string;
  // 生图中转（任意 OpenAI 兼容端点 → gpt-image 系列）
  imageApiBase?: string;
  imageApiKey?: string;
  imageModel?: string;
  imageQuality?: string;
  // 文章配图搜图（国际免费图库，与生图引擎互相独立）
  pexelsApiKey?: string;
  pixabayApiKey?: string;
  // 素材翻译引擎（英文素材标题+摘要译中文；与文案生成引擎相互独立，key 复用所选引擎已存的那把）
  translateEnabled?: boolean;
  translateProvider?: LlmProvider;
  translateModel?: string;
  // 轻量任务引擎（AI 标题重写 / 小红书高亮 / 段落 emoji 这类小任务；同样独立可配，key 复用）
  flashProvider?: LlmProvider;
  flashModel?: string;
  // RSS 采集：保留最近多少天的未处理素材（防过时污染选题池），默认 7 天
  rssRetentionDays?: number;
  // 邮件通知（Resend）：key 与「每日采集摘要」开关
  resendApiKey?: string;
  dailySummary?: boolean;
  // RSS 订阅源列表（网页设置管理，不走 env）
  rssFeeds?: RssFeedConfig[];
  // ===== 配图与封面预设（生文流水线按这套预设走，不用生成后再逐篇挑）=====
  // 文内配图默认方式：search 图库搜图 / ai AI 生图解 / off 不配图
  illustrateMode?: IllustrateMode;
  // 预设为 AI 生图时用哪套风格 + 自动配几张（1-4）
  aiIllustrateStyle?: string;
  aiIllustrateCount?: number;
  // 封面默认风格 key（lib/cover-styles.ts 注册表），比例跟随该风格的 defaultRatio
  coverStyle?: string;
}

// 读取存储的原始配置（可能为空）
export async function getStoredConfig(): Promise<AppConfig> {
  const v = (await getSyncState(CONFIG_KEY).catch(() => null)) as AppConfig | null;
  return v && typeof v === "object" ? v : {};
}

// 合并写入配置（只覆盖传入的字段）
export async function updateStoredConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const cur = await getStoredConfig();
  const next = { ...cur, ...patch };
  await setSyncState(CONFIG_KEY, next);
  return next;
}

// 生效的默认写作风格：脏值/未设置一律退回 default
export async function resolveWritingStyle(): Promise<WritingStyle> {
  const c = await getStoredConfig();
  return normalizeStyle(c.writingStyle);
}

// ===== 生效的「配图与封面预设」=====
// 生文流水线（lib/finalize-wechat.ts）与稿件页的初始选中项都读这一份，用户在设置页预设一次，
// 之后每篇稿子自动按这套走，不用生成完再逐篇挑搜图还是 AI 生图、封面用什么风格。
// 脏值一律退回默认（搜图 + 手绘知识风 + 玻璃气泡风封面），不让坏配置打断出稿。
export interface ImagePreset {
  mode: IllustrateMode;
  aiStyleKey: string;
  aiCount: number;
  coverStyle: CoverStyle;
}

export function resolveImagePreset(c: AppConfig): ImagePreset {
  const rawCount = Number(c.aiIllustrateCount);
  const aiCount = Number.isFinite(rawCount)
    ? Math.max(1, Math.min(Math.floor(rawCount), MAX_AI_ILLUSTRATIONS))
    : 2; // 自动链路默认 2 张：够用又不至于让一篇稿子烧掉 4 张图的钱
  return {
    mode: normalizeIllustrateMode(c.illustrateMode),
    aiStyleKey: resolveAiIllustrateStyle(c.aiIllustrateStyle).key,
    aiCount,
    coverStyle: resolveCoverStyle(c.coverStyle),
  };
}

export async function getImagePreset(): Promise<ImagePreset> {
  return resolveImagePreset(await getStoredConfig());
}

// 生效的文案引擎提供方：DB > env > deepseek
export function resolveLlmProvider(c: AppConfig): LlmProvider {
  if (isLlmProvider(c.llmProvider)) return c.llmProvider;
  if (isLlmProvider(process.env.LLM_PROVIDER)) return process.env.LLM_PROVIDER;
  return "deepseek";
}

// 某一家引擎的生效接口根地址：deepseek/qwen/kimi 固定用注册表官方地址；
// relay（聚合中转）可被 DB 配置或 env 覆盖成任意 OpenAI 兼容端点，未配置时回落默认示例。
// 统一去掉结尾斜杠，调用方直接拼 /models、/chat/completions。
export function resolveProviderBaseUrl(provider: LlmProvider, c: AppConfig): string {
  const meta = LLM_PROVIDERS[provider];
  const raw = provider === "relay" ? c.relayBaseUrl || process.env.RELAY_BASE_URL || meta.baseUrl : meta.baseUrl;
  return raw.replace(/\/+$/, "");
}

// 某一家引擎的生效 key/model/baseUrl/来源：DB > env > 注册表默认。与当前选中哪家无关，
// 因此设置页可以一次性回显各家、测试连接也能测「正在编辑但还没启用」的那家。
export async function resolveProviderConfig(
  provider: LlmProvider,
  stored?: AppConfig,
): Promise<{ apiKey: string; model: string; baseUrl: string; source: "db" | "env" | "none" }> {
  const c = stored ?? (await getStoredConfig());
  const meta = LLM_PROVIDERS[provider];
  const apiKey = c[meta.keyField] || process.env[meta.keyEnv] || "";
  const model = c[meta.modelField] || process.env[meta.modelEnv] || meta.defaultModel;
  const baseUrl = resolveProviderBaseUrl(provider, c);
  const source = c[meta.keyField] ? "db" : process.env[meta.keyEnv] ? "env" : "none";
  return { apiKey, model, baseUrl, source };
}

// 生效的文案引擎配置：provider 决定用哪一组 key/model/baseUrl
export async function resolveLlmConfig(): Promise<{
  provider: LlmProvider;
  apiKey: string;
  model: string;
  baseUrl: string;
  source: "db" | "env" | "none";
}> {
  const c = await getStoredConfig();
  const provider = resolveLlmProvider(c);
  return { provider, ...(await resolveProviderConfig(provider, c)) };
}

// 生效的生图配置：DB > env
export async function resolveImageConfig(): Promise<{
  base: string;
  apiKey: string;
  model: string;
  quality: string;
  source: "db" | "env" | "none";
}> {
  const c = await getStoredConfig();
  // 生图端点可指向任意 OpenAI 兼容服务；默认示例 yunwu.ai 仅为占位，与本项目无利益关系
  const base = (c.imageApiBase || process.env.IMAGE_API_BASE || "https://yunwu.ai/v1").replace(/\/$/, "");
  const apiKey = c.imageApiKey || process.env.IMAGE_API_KEY || "";
  const model = c.imageModel || process.env.IMAGE_MODEL || "gpt-image-2";
  const quality = c.imageQuality || process.env.IMAGE_QUALITY || "medium";
  const source = c.imageApiKey ? "db" : process.env.IMAGE_API_KEY ? "env" : "none";
  return { base, apiKey, model, quality, source };
}

// 生效的搜图配置：DB > env。Pexels 主用、Pixabay 兜底，两把 key 至少有一把即可用
export async function resolveImageSearchConfig(): Promise<{
  pexelsKey: string;
  pixabayKey: string;
  source: "db" | "env" | "none";
}> {
  const c = await getStoredConfig();
  const pexelsKey = c.pexelsApiKey || process.env.PEXELS_API_KEY || "";
  const pixabayKey = c.pixabayApiKey || process.env.PIXABAY_API_KEY || "";
  const source =
    c.pexelsApiKey || c.pixabayApiKey
      ? "db"
      : process.env.PEXELS_API_KEY || process.env.PIXABAY_API_KEY
        ? "env"
        : "none";
  return { pexelsKey, pixabayKey, source };
}

// 生效的素材翻译配置：开关默认开，引擎默认经聚合中转站调 deepseek-v4-flash（翻译量级下成本可忽略）。
// key 不单独存：复用所选引擎在 llmProviders 里已存的 key，避免同一把 key 存两份。
export async function resolveTranslateConfig(): Promise<{
  enabled: boolean;
  provider: LlmProvider;
  model: string;
  apiKey: string;
  baseUrl: string;
  source: "db" | "env" | "none";
}> {
  const c = await getStoredConfig();
  const enabled = c.translateEnabled !== false;
  const provider = isLlmProvider(c.translateProvider) ? c.translateProvider : "relay";
  const model = c.translateModel || "deepseek-v4-flash";
  const { apiKey, baseUrl, source } = await resolveProviderConfig(provider, c);
  return { enabled, provider, model, apiKey, baseUrl, source };
}

// 生效的轻量任务引擎配置：默认经聚合中转站调 deepseek-v4-flash（延迟低、成本低）。
// 历史注意：此前 getFlashModel 写死 DeepSeek 官方 flash，用户切引擎后标题重写/小红书高亮
// 仍静默打 DeepSeek——2026-07-18 起改为独立可配置，与翻译引擎同款机制（key 复用所选引擎已存的）。
export async function resolveFlashConfig(): Promise<{
  provider: LlmProvider;
  model: string;
  apiKey: string;
  baseUrl: string;
  source: "db" | "env" | "none";
}> {
  const c = await getStoredConfig();
  const provider = isLlmProvider(c.flashProvider) ? c.flashProvider : "relay";
  const model = c.flashModel || "deepseek-v4-flash";
  const { apiKey, baseUrl, source } = await resolveProviderConfig(provider, c);
  return { provider, model, apiKey, baseUrl, source };
}

// RSS 未处理素材保留天数：默认 7 天（RSS 多为深度长文源，节奏慢）。
// 取整：make_interval(days => …) 的 days 是 integer 形参，传小数会绑定类型报错。
export async function resolveRssRetentionDays(): Promise<number> {
  const c = await getStoredConfig();
  const n = c.rssRetentionDays ?? Number(process.env.RSS_RETENTION_DAYS ?? 7);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 7;
}

// 生效的 Resend 邮件配置：DB > env
export async function resolveResendConfig(): Promise<{ apiKey: string; source: "db" | "env" | "none" }> {
  const c = await getStoredConfig();
  const apiKey = c.resendApiKey || process.env.RESEND_API_KEY || "";
  const source = c.resendApiKey ? "db" : process.env.RESEND_API_KEY ? "env" : "none";
  return { apiKey, source };
}

// 每日采集摘要开关（默认关）
export async function resolveDailySummary(): Promise<boolean> {
  const c = await getStoredConfig();
  return c.dailySummary === true;
}

// RSS 订阅源列表（只认存储配置里的合法条目）
export async function resolveRssFeeds(): Promise<RssFeedConfig[]> {
  const c = await getStoredConfig();
  if (!Array.isArray(c.rssFeeds)) return [];
  return c.rssFeeds.filter(
    (f): f is RssFeedConfig => !!f && typeof f === "object" && typeof f.url === "string" && f.url.length > 0,
  );
}

// URL 安全校验（防 SSRF）：必须 http(s)，且拒绝私网/环回/链路本地/云元数据地址。
// 用于生图 API Base、RSS 源地址等「用户可写入、服务端会去 fetch」的 URL。
export function isSafePublicUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) || // 链路本地 / 云元数据 169.254.169.254
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return false;
  }
  return true;
}

// 供路由做「是否已配置」判断
export async function llmConfigured(): Promise<boolean> {
  return (await resolveLlmConfig()).apiKey.length > 0;
}
export async function imageConfigured(): Promise<boolean> {
  return (await resolveImageConfig()).apiKey.length > 0;
}
export async function imageSearchConfigured(): Promise<boolean> {
  const c = await resolveImageSearchConfig();
  return c.pexelsKey.length > 0 || c.pixabayKey.length > 0;
}
