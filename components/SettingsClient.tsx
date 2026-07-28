"use client";
import type { WritingStyle } from "@/lib/styles";
import { StyleCard } from "@/components/settings/StyleCard";
import { LlmEngineCard } from "@/components/settings/LlmEngineCard";
import { ImageEngineCard } from "@/components/settings/ImageEngineCard";
import { SearchEngineCard } from "@/components/settings/SearchEngineCard";
import { RssFeedsCard } from "@/components/settings/RssFeedsCard";
import { TranslateCard } from "@/components/settings/TranslateCard";
import { FlashCard } from "@/components/settings/FlashCard";
import { NotifyCard } from "@/components/settings/NotifyCard";
import type { ProviderState } from "@/components/settings/LlmEngineCard";
import type { LlmProvider } from "@/lib/llm-providers";
import type { SyncInfo } from "@/components/settings/shared";

// 设置页初始配置。私有单人工作台（全站门禁之后）：API key 明文下发，配合「点击可见」展示。
export interface SettingsInit {
  writingStyle: WritingStyle;
  llmEnabled: boolean;
  llmProvider: LlmProvider;
  llmSource: "db" | "env" | "none";
  /** 三家引擎各自已存的 key/model，切换引擎时直接回显 */
  llmProviders: Record<LlmProvider, ProviderState>;
  imageEnabled: boolean;
  imageApiKey: string;
  imageBase: string;
  imageModel: string;
  imageQuality: string;
  imageSource: "db" | "env" | "none";
  searchEnabled: boolean;
  searchSource: "db" | "env" | "none";
  pexelsApiKey: string;
  pixabayApiKey: string;
  rssRetentionDays: number;
  resendEnabled: boolean;
  resendSource: "db" | "env" | "none";
  dailySummary: boolean;
  rssFeeds: { url: string; pillar: string; label?: string }[];
  rssSync: SyncInfo | null;
  /** 上次全库清理时间（sync_state 的 cleanup 键） */
  lastPrunedAt: string | null;
  translateEnabled: boolean;
  /** 翻译所选引擎是否已有可用 key */
  translateKeyConfigured: boolean;
  translateProvider: LlmProvider;
  translateModel: string;
  /** 轻量任务引擎（标题重写/小红书高亮/emoji） */
  flashKeyConfigured: boolean;
  flashProvider: LlmProvider;
  flashModel: string;
}

// 纯布局容器：把 init 按配置域切片，分发给各自的卡片组件。
// 每张卡片自带 useState + 保存逻辑，保存态/消息态互不干扰。
export function SettingsClient({ init }: { init: SettingsInit }) {
  return (
    <div className="space-y-4">
      <StyleCard initialStyle={init.writingStyle} />

      <LlmEngineCard
        enabled={init.llmEnabled}
        source={init.llmSource}
        provider={init.llmProvider}
        providers={init.llmProviders}
      />

      <FlashCard
        keyConfigured={init.flashKeyConfigured}
        provider={init.flashProvider}
        model={init.flashModel}
      />

      <ImageEngineCard
        enabled={init.imageEnabled}
        source={init.imageSource}
        apiKey={init.imageApiKey}
        base={init.imageBase}
        model={init.imageModel}
        quality={init.imageQuality}
      />

      <SearchEngineCard
        enabled={init.searchEnabled}
        source={init.searchSource}
        pexelsApiKey={init.pexelsApiKey}
        pixabayApiKey={init.pixabayApiKey}
      />

      <RssFeedsCard
        feeds={init.rssFeeds}
        sync={init.rssSync}
        rssRetentionDays={init.rssRetentionDays}
        lastPrunedAt={init.lastPrunedAt}
      />

      <TranslateCard
        enabled={init.translateEnabled}
        keyConfigured={init.translateKeyConfigured}
        provider={init.translateProvider}
        model={init.translateModel}
      />

      <NotifyCard enabled={init.resendEnabled} source={init.resendSource} dailySummary={init.dailySummary} />
    </div>
  );
}
