import {
  resolveLlmConfig,
  resolveImageConfig,
  resolveImageSearchConfig,
  resolveRssRetentionDays,
  resolveResendConfig,
  resolveProviderConfig,
  resolveTranslateConfig,
  resolveFlashConfig,
  getStoredConfig,
} from "@/lib/config";
import { LLM_PROVIDER_IDS, type LlmProvider } from "@/lib/llm-providers";
import type { ProviderState } from "@/components/settings/LlmEngineCard";
import { getSyncState } from "@/lib/queries";
import { CLEANUP_SYNC_KEY } from "@/lib/cleanup";
import { normalizeStyle } from "@/lib/styles";
import { SettingsClient, type SettingsInit } from "@/components/SettingsClient";
import { isReadOnly } from "@/lib/read-only";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Eye } from "lucide-react";

export const dynamic = "force-dynamic";

// RSS 采集状态（sync_state 的 rss 键）
interface SyncInfo {
  lastRunAt?: string | null;
  lastSuccessAt?: string | null;
  lastError?: string | null;
  lastErrorAt?: string | null;
  lastFetched?: number | null;
  lastInserted?: number | null;
}

export default async function SettingsPage() {
  // 只读演示站：设置页整页不渲染表单。这里是全站最危险的一屏——能改文案/生图引擎的
  // Base URL 和 key，被人改成内网地址就是一个现成的 SSRF 入口。服务端已经 403 拦死写请求，
  // 这里再从 UI 上整个拿掉，免得访客对着一堆填不进去的输入框瞎试。
  if (isReadOnly()) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <h1 className="text-2xl font-bold">设置</h1>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Eye className="size-4" /> 只读模式，设置页已关闭
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              这是公开演示站，开着只读模式：RSS 订阅源、文案引擎、生图引擎、API Key
              这些都不能改，所有写请求都会被服务端拒绝。
            </p>
            <p>
              想完整体验（配自己的订阅源、填自己的 Key、生成稿件），
              <a
                href="https://github.com/LeoLee0812/media-studio-oss"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                自己部署一套
              </a>
              ——README 里有一段现成的提示词，复制给 AI 编程助手就能从头装到能用。
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const [llm, image, search, rssRetentionDays, resend, stored, rss, cleanup] =
    await Promise.all([
      resolveLlmConfig(),
      resolveImageConfig(),
      resolveImageSearchConfig(),
      resolveRssRetentionDays(),
      resolveResendConfig(),
      getStoredConfig(),
      getSyncState("rss").catch(() => null) as Promise<SyncInfo | null>,
      getSyncState(CLEANUP_SYNC_KEY).catch(() => null) as Promise<{ lastPrunedAt?: string } | null>,
    ]);
  const translate = await resolveTranslateConfig();
  const flash = await resolveFlashConfig();

  // 各文案引擎自己的生效配置（key 明文给设置页做「点击可见」，全站在门禁之后）
  const entries = await Promise.all(
    LLM_PROVIDER_IDS.map(async (id) => {
      const { apiKey, model } = await resolveProviderConfig(id, stored);
      return [id, { apiKey, model }] as const;
    }),
  );
  const llmProviders = Object.fromEntries(entries) as Record<LlmProvider, ProviderState>;

  const init: SettingsInit = {
    writingStyle: normalizeStyle(stored.writingStyle),
    llmEnabled: llm.apiKey.length > 0,
    llmProvider: llm.provider,
    llmSource: llm.source,
    llmProviders,
    relayBaseUrl: stored.relayBaseUrl ?? "",
    imageEnabled: image.apiKey.length > 0,
    imageApiKey: image.apiKey,
    imageBase: image.base,
    imageModel: image.model,
    imageQuality: image.quality,
    imageSource: image.source,
    searchEnabled: search.pexelsKey.length > 0 || search.pixabayKey.length > 0,
    searchSource: search.source,
    pexelsApiKey: search.pexelsKey,
    pixabayApiKey: search.pixabayKey,
    rssRetentionDays,
    resendEnabled: resend.apiKey.length > 0,
    resendSource: resend.source,
    dailySummary: stored.dailySummary === true,
    rssFeeds: Array.isArray(stored.rssFeeds) ? stored.rssFeeds : [],
    rssSync: rss,
    lastPrunedAt: cleanup?.lastPrunedAt ?? null,
    translateEnabled: translate.enabled,
    translateKeyConfigured: translate.apiKey.length > 0,
    translateProvider: translate.provider,
    translateModel: translate.model,
    flashKeyConfigured: flash.apiKey.length > 0,
    flashProvider: flash.provider,
    flashModel: flash.model,
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <h1 className="text-2xl font-bold">设置</h1>
      <SettingsClient init={init} />
    </div>
  );
}
