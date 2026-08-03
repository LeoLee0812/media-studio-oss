import { NextResponse } from "next/server";
import {
  getStoredConfig,
  updateStoredConfig,
  resolveLlmConfig,
  resolveImageConfig,
  resolveRssRetentionDays,
  resolveResendConfig,
  resolveImageSearchConfig,
  resolveProviderConfig,
  isSafePublicUrl,
  resolveImagePreset,
  type AppConfig,
  type RssFeedConfig,
} from "@/lib/config";
import { isIllustrateMode, resolveAiIllustrateStyle, MAX_AI_ILLUSTRATIONS } from "@/lib/illustrate-styles";
import { COVER_STYLES } from "@/lib/cover-styles";
import { LLM_PROVIDERS, LLM_PROVIDER_IDS, isLlmProvider } from "@/lib/llm-providers";
import { isGateEnabled } from "@/lib/auth";
import { getSyncState } from "@/lib/queries";
import { isWritingStyle, normalizeStyle } from "@/lib/styles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 返回前端所需的运行时配置。安全：绝不回传明文 API key，只给「是否已配置 + 来源 + 非密字段」。
export async function GET() {
  const [llm, image, search, rssRetentionDays, resend, stored, rss] =
    await Promise.all([
      resolveLlmConfig(),
      resolveImageConfig(),
      resolveImageSearchConfig(),
      resolveRssRetentionDays(),
      resolveResendConfig(),
      getStoredConfig(),
      getSyncState("rss").catch(() => null),
    ]);
  // 私有单人工作台（全站门禁之后）：API key 明文回传给设置页做「点击可见」展示。
  // 三家各自的 key/model 一次性给全，切换引擎时前端直接回显、不用再请求。
  //
  // ⚠️ 公开模式（没配 ACCESS_PASSWORD，任何人都能访问）下这条不成立：明文回传等于把 key
  // 送给所有访客。所以下面 maskSecret() 会把所有密钥字段抹成空串，只留 *Enabled 布尔与
  // 非密字段——设置页照样能填新 key（写入不受影响），只是不再回显已存的值。
  const openMode = !isGateEnabled();
  const maskSecret = (v: string) => (openMode ? "" : v);
  // 配图与封面预设（非密，公开模式下也照常回传）
  const imagePreset = resolveImagePreset(stored);
  const llmProviders = Object.fromEntries(
    await Promise.all(
      LLM_PROVIDER_IDS.map(async (id) => {
        const cfg = await resolveProviderConfig(id, stored);
        return [id, { ...cfg, apiKey: maskSecret(cfg.apiKey) }] as const;
      }),
    ),
  );
  return NextResponse.json({
    // 公开模式（无访问密码）：密钥字段一律不回显
    openMode,
    // 默认写作风格（选题页/洗稿页的初始选中项）
    writingStyle: normalizeStyle(stored.writingStyle),
    llmEnabled: llm.apiKey.length > 0,
    llmProvider: llm.provider, // deepseek | qwen | kimi | relay
    model: llm.model,
    llmSource: llm.source, // db | env | none
    // { [provider]: { apiKey, model, baseUrl, source } }
    llmProviders,
    // 聚合中转站 Base URL（DB 存的原始值；空 = 用 env/默认示例）
    relayBaseUrl: stored.relayBaseUrl ?? "",
    imageEnabled: image.apiKey.length > 0,
    imageApiKey: maskSecret(image.apiKey),
    imageBase: image.base,
    imageModel: image.model,
    imageQuality: image.quality,
    imageSource: image.source,
    // 文章配图搜图（Pexels / Pixabay）
    searchEnabled: search.pexelsKey.length > 0 || search.pixabayKey.length > 0,
    searchSource: search.source,
    pexelsApiKey: maskSecret(search.pexelsKey),
    pixabayApiKey: maskSecret(search.pixabayKey),
    rssRetentionDays,
    // 邮件通知（key 只报是否配置）
    resendEnabled: resend.apiKey.length > 0,
    resendSource: resend.source,
    dailySummary: stored.dailySummary === true,
    // RSS 订阅源（url/板块/备注非密，直接回传供编辑）
    rssFeeds: Array.isArray(stored.rssFeeds) ? stored.rssFeeds : [],
    rssSync: rss,
    // 配图与封面预设（生文流水线按它走）
    illustrateMode: imagePreset.mode,
    aiIllustrateStyle: imagePreset.aiStyleKey,
    aiIllustrateCount: imagePreset.aiCount,
    coverStyle: imagePreset.coverStyle.key,
  });
}

// 保存配置（设置页）。只更新传入的字段；key 类字段传空串则跳过（避免误清），
// 传入约定占位串 "__CLEAR__" 才显式清空。
const CLEAR = "__CLEAR__";

// 密钥类字段写入规则：非空才写；显式清空需传 __CLEAR__。多处校验函数共用。
function applySecretField(patch: Partial<AppConfig>, body: Record<string, unknown>, f: keyof AppConfig) {
  const v = body[f];
  if (typeof v === "string") {
    if (v === CLEAR) patch[f] = "" as never;
    else if (v.trim()) patch[f] = v.trim() as never;
  }
}

// 非密字段写入规则：非空即写。多处校验函数共用。
function applyPlainField(patch: Partial<AppConfig>, body: Record<string, unknown>, f: keyof AppConfig) {
  const v = body[f];
  if (typeof v === "string" && v.trim()) patch[f] = v.trim() as never;
}

// 文案引擎域：提供方 + 默认写作风格 + 各家 key/model（字段名从注册表取，加一家引擎这里不用动）
// relay（聚合中转）额外收 Base URL：空串 = 清除（回落 env/默认示例）；非空须过 SSRF 校验
// （文案请求会带真实 key 的 Bearer 头打到这个地址），非法直接 400 不写库。
function validateLlmPatch(patch: Partial<AppConfig>, body: Record<string, unknown>): string | null {
  if (isLlmProvider(body.llmProvider)) patch.llmProvider = body.llmProvider;
  if (isWritingStyle(body.writingStyle)) patch.writingStyle = body.writingStyle;
  for (const id of LLM_PROVIDER_IDS) {
    applySecretField(patch, body, LLM_PROVIDERS[id].keyField);
    applyPlainField(patch, body, LLM_PROVIDERS[id].modelField);
  }
  if (typeof body.relayBaseUrl === "string") {
    const v = body.relayBaseUrl.trim().replace(/\/+$/, "");
    if (!v) patch.relayBaseUrl = "";
    else if (!isSafePublicUrl(v)) return "中转站 Base URL 非法：必须是 http(s) 且不能指向内网/环回地址";
    else patch.relayBaseUrl = v;
  }
  return null;
}

// 生图域：base 先做 SSRF 校验（生图请求会带真实 key 的 Bearer 头），非法直接 400 不写库
function validateImagePatch(patch: Partial<AppConfig>, body: Record<string, unknown>): string | null {
  if (typeof body.imageApiBase === "string" && body.imageApiBase.trim()) {
    if (!isSafePublicUrl(body.imageApiBase.trim())) {
      return "生图 API Base 非法：必须是 http(s) 且不能指向内网/环回地址";
    }
  }
  applySecretField(patch, body, "imageApiKey");
  applyPlainField(patch, body, "imageApiBase");
  applyPlainField(patch, body, "imageModel");
  applyPlainField(patch, body, "imageQuality");
  return null;
}

// 文章配图搜图域：Pexels / Pixabay 两把 key
function validateSearchPatch(patch: Partial<AppConfig>, body: Record<string, unknown>) {
  applySecretField(patch, body, "pexelsApiKey");
  applySecretField(patch, body, "pixabayApiKey");
}

// 素材翻译域：开关 + 引擎 + 模型（key 复用所选引擎已存的，不在这里收）
function validateTranslatePatch(patch: Partial<AppConfig>, body: Record<string, unknown>) {
  if (typeof body.translateEnabled === "boolean") patch.translateEnabled = body.translateEnabled;
  if (isLlmProvider(body.translateProvider)) patch.translateProvider = body.translateProvider;
  applyPlainField(patch, body, "translateModel");
}

// 轻量任务引擎域：标题重写/小红书高亮/emoji 用的引擎 + 模型（key 同样复用）
function validateFlashPatch(patch: Partial<AppConfig>, body: Record<string, unknown>) {
  if (isLlmProvider(body.flashProvider)) patch.flashProvider = body.flashProvider;
  applyPlainField(patch, body, "flashModel");
}

// 采集保留天数域：数字且 >0 才写
function validateRetentionPatch(patch: Partial<AppConfig>, body: Record<string, unknown>) {
  const rssDays = Number(body.rssRetentionDays);
  if (Number.isFinite(rssDays) && rssDays > 0) patch.rssRetentionDays = Math.floor(rssDays);
}

// RSS 源列表域：传数组即整体覆盖（含空数组 = 清空）。逐条校验 url 防 SSRF；
// 板块是自由分类字符串：trim、超长截断 30 字符、空的归一化成「未分类」。
function validateRssFeedsPatch(patch: Partial<AppConfig>, body: Record<string, unknown>): string | null {
  if (!Array.isArray(body.rssFeeds)) return null;
  const feeds: RssFeedConfig[] = [];
  for (const raw of body.rssFeeds) {
    if (!raw || typeof raw !== "object") continue;
    const f = raw as Record<string, unknown>;
    const url = typeof f.url === "string" ? f.url.trim() : "";
    if (!url) continue; // 空行直接忽略
    if (!isSafePublicUrl(url)) {
      return `RSS 源地址非法（必须 http(s) 且非内网）：${url}`;
    }
    const pillar = (typeof f.pillar === "string" ? f.pillar.trim().slice(0, 30) : "") || "未分类";
    const label = typeof f.label === "string" && f.label.trim() ? f.label.trim() : undefined;
    feeds.push({ url, pillar, ...(label ? { label } : {}) });
  }
  patch.rssFeeds = feeds;
  return null;
}

// 配图与封面预设域：文内配图方式 + AI 配图风格/张数 + 封面风格。
// 脏值一律忽略（不写库），由 resolveImagePreset 兜底到默认，不让坏配置打断出稿。
function validateImagePresetPatch(patch: Partial<AppConfig>, body: Record<string, unknown>) {
  if (isIllustrateMode(body.illustrateMode)) patch.illustrateMode = body.illustrateMode;
  if (typeof body.aiIllustrateStyle === "string") {
    const key = body.aiIllustrateStyle.trim();
    if (key && resolveAiIllustrateStyle(key).key === key) patch.aiIllustrateStyle = key;
  }
  const count = Number(body.aiIllustrateCount);
  if (Number.isFinite(count) && count >= 1) {
    patch.aiIllustrateCount = Math.min(Math.floor(count), MAX_AI_ILLUSTRATIONS);
  }
  if (typeof body.coverStyle === "string" && COVER_STYLES.some((s) => s.key === body.coverStyle)) {
    patch.coverStyle = body.coverStyle;
  }
}

// 邮件通知域：Resend key + 每日摘要开关
function validateNotifyPatch(patch: Partial<AppConfig>, body: Record<string, unknown>) {
  applySecretField(patch, body, "resendApiKey");
  if (typeof body.dailySummary === "boolean") patch.dailySummary = body.dailySummary;
}

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Partial<AppConfig> = {};

  const imageError = validateImagePatch(patch, body);
  if (imageError) return NextResponse.json({ error: imageError }, { status: 400 });

  const llmError = validateLlmPatch(patch, body);
  if (llmError) return NextResponse.json({ error: llmError }, { status: 400 });
  validateSearchPatch(patch, body);
  validateTranslatePatch(patch, body);
  validateFlashPatch(patch, body);
  validateRetentionPatch(patch, body);
  validateNotifyPatch(patch, body);
  validateImagePresetPatch(patch, body);

  const rssError = validateRssFeedsPatch(patch, body);
  if (rssError) return NextResponse.json({ error: rssError }, { status: 400 });

  const next = await updateStoredConfig(patch);
  return NextResponse.json({
    ok: true,
    saved: Object.keys(patch),
    hasDeepseekKey: !!next.deepseekApiKey,
    hasImageKey: !!next.imageApiKey,
    hasResendKey: !!next.resendApiKey,
    llmModel: next.llmModel ?? null,
    imageApiBase: next.imageApiBase ?? null,
    imageModel: next.imageModel ?? null,
    imageQuality: next.imageQuality ?? null,
    rssRetentionDays: next.rssRetentionDays ?? null,
    dailySummary: next.dailySummary === true,
    rssFeeds: next.rssFeeds ?? [],
  });
}
