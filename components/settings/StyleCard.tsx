"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { STYLE_DEFS, getStyleDef, type WritingStyle } from "@/lib/styles";
import { useSectionSave } from "./shared";

// 默认写作风格：选题页/洗稿页的初始选中项，逐篇仍可改
export function StyleCard({ initialStyle }: { initialStyle: WritingStyle }) {
  const [writingStyle, setWritingStyle] = useState<WritingStyle>(initialStyle);
  const { saving, msg, save } = useSectionSave();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">默认写作风格</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="space-y-2">
          <label className="text-muted-foreground">
            新生成稿件时默认用哪种文风（选题页、洗稿页仍可逐篇临时切换）
          </label>
          <div className="flex flex-wrap gap-2">
            {STYLE_DEFS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setWritingStyle(s.id)}
                className={
                  "rounded-md border px-3 py-1.5 text-sm transition-colors " +
                  (writingStyle === s.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:bg-accent")
                }
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{getStyleDef(writingStyle).hint}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={saving} onClick={() => save({ writingStyle })}>
            {saving ? "保存中…" : "保存"}
          </Button>
          {msg && <span className="text-muted-foreground">{msg}</span>}
          <a href="/prompts" className="ml-auto text-blue-500 hover:underline">
            到提示词页微调风格文案 ↗
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
