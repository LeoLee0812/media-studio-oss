"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SourceBadge, useSectionSave } from "./shared";
import { LLM_PROVIDERS, LLM_PROVIDER_IDS, type LlmProvider } from "@/lib/llm-providers";

// 轻量任务引擎：AI 标题重写 / 小红书高亮选点 / 段落 emoji 这类小任务用的模型。
// 与「文案生成引擎」独立——写稿用旗舰，小任务用便宜快的 flash 级模型就够。
// 历史：此前写死 DeepSeek 官方 flash（切引擎后这三个功能仍静默打 DeepSeek），现改为可配置。
// key 不单独存：复用所选引擎在文案引擎卡片里已存的那把。
export function FlashCard({
  keyConfigured,
  provider: initialProvider,
  model: initialModel,
}: {
  /** 所选引擎是否已有可用 key */
  keyConfigured: boolean;
  provider: LlmProvider;
  model: string;
}) {
  const [provider, setProvider] = useState<LlmProvider>(initialProvider);
  const [model, setModel] = useState(initialModel);
  const { saving, msg, save } = useSectionSave();

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">轻量任务引擎</CardTitle>
        <SourceBadge enabled={keyConfigured} source="db" />
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          AI 标题重写、小红书高亮选点、段落 emoji 这类小任务走这里（key 复用文案引擎卡片里已存的）。
          所选引擎没 key 时自动退回文案生成引擎。
        </p>
        <div className="space-y-1">
          <label className="text-muted-foreground">引擎</label>
          <div className="flex flex-wrap gap-2">
            {LLM_PROVIDER_IDS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setProvider(id)}
                className={
                  "rounded-md border px-3 py-1.5 text-sm transition-colors " +
                  (provider === id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")
                }
              >
                {LLM_PROVIDERS[id].label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-muted-foreground">模型（用轻量快速的就够，不用旗舰）</label>
          <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-v4-flash" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            disabled={saving}
            onClick={() => save({ flashProvider: provider, flashModel: model })}
          >
            {saving ? "保存中…" : "保存"}
          </Button>
          {msg && <span className="text-muted-foreground">{msg}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
