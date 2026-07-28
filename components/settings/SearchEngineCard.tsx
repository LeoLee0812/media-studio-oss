"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { KeyInput, SourceBadge, useSectionSave } from "./shared";

// 文章配图搜图：公众号稿件页「AI 配图」用的免费图库 key（Pexels / Pixabay）
export function SearchEngineCard({
  enabled,
  source,
  pexelsApiKey: initialPexelsApiKey,
  pixabayApiKey: initialPixabayApiKey,
}: {
  enabled: boolean;
  source: "db" | "env" | "none";
  pexelsApiKey: string;
  pixabayApiKey: string;
}) {
  const [pexelsApiKey, setPexelsApiKey] = useState(initialPexelsApiKey);
  const [pixabayApiKey, setPixabayApiKey] = useState(initialPixabayApiKey);
  const { saving, msg, save } = useSectionSave();

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">文章配图搜图（Pexels / Pixabay）</CardTitle>
        <SourceBadge enabled={enabled} source={source} />
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="space-y-1">
          <label className="text-muted-foreground">Pexels API Key（点右侧眼睛可见）</label>
          <KeyInput value={pexelsApiKey} onChange={setPexelsApiKey} placeholder="Pexels key" />
        </div>
        <div className="space-y-1">
          <label className="text-muted-foreground">Pixabay API Key（可不填）</label>
          <KeyInput value={pixabayApiKey} onChange={setPixabayApiKey} placeholder="Pixabay key" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            disabled={saving}
            onClick={() =>
              save({
                ...(pexelsApiKey ? { pexelsApiKey } : {}),
                ...(pixabayApiKey ? { pixabayApiKey } : {}),
              })
            }
          >
            {saving ? "保存中…" : "保存"}
          </Button>
          {msg && <span className="text-muted-foreground">{msg}</span>}
        </div>
        <p className="text-xs text-muted-foreground">
          公众号稿件页「AI 配图」按钮：AI 选插图点 → 图库搜图插入正文 → 原图下载到本地绑定文件夹。两个图库都免费，配一个即可用；两个都配时并发竞速，谁先搜到用谁。
        </p>
      </CardContent>
    </Card>
  );
}
