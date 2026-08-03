"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useSectionSave } from "./shared";
import {
  AI_ILLUSTRATE_STYLES,
  ILLUSTRATE_MODES,
  MAX_AI_ILLUSTRATIONS,
  resolveAiIllustrateStyle,
  type IllustrateMode,
} from "@/lib/illustrate-styles";
import { COVER_STYLES, resolveCoverStyle } from "@/lib/cover-styles";

// 配图与封面预设：把原来「稿件页每篇现挑搜图还是 AI 生图、封面用哪种风格」提前成一次性预设，
// 生文流水线（lib/finalize-wechat.ts）出稿时直接照办。稿件页仍可逐篇临时改，不影响这份默认值。
export function ImagePresetCard({
  illustrateMode: initialMode,
  aiIllustrateStyle: initialAiStyle,
  aiIllustrateCount: initialCount,
  coverStyle: initialCoverStyle,
}: {
  illustrateMode: IllustrateMode;
  aiIllustrateStyle: string;
  aiIllustrateCount: number;
  coverStyle: string;
}) {
  const [mode, setMode] = useState<IllustrateMode>(initialMode);
  const [aiStyle, setAiStyle] = useState(initialAiStyle);
  const [count, setCount] = useState(initialCount);
  const [coverStyle, setCoverStyle] = useState(initialCoverStyle);
  const { saving, msg, save } = useSectionSave();

  const modeDef = ILLUSTRATE_MODES.find((m) => m.id === mode) ?? ILLUSTRATE_MODES[0];
  const cover = resolveCoverStyle(coverStyle);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">配图与封面预设</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-xs text-muted-foreground">
          在这里预设一次，之后每篇稿子生成时自动按这套走（文内配图方式 + 封面风格），
          不用出稿后再逐篇挑。稿件页仍可对单篇临时换风格或重做。
        </p>

        {/* ① 文内配图默认方式 */}
        <div className="space-y-2">
          <label className="font-medium">文内配图默认方式</label>
          <div className="flex flex-wrap gap-2">
            {ILLUSTRATE_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className={
                  "rounded-md border px-3 py-1.5 text-sm transition-colors " +
                  (mode === m.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:bg-accent")
                }
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{modeDef.hint}</p>
        </div>

        {/* ② AI 生图时的风格与张数（只在选了 AI 生图时才有意义） */}
        {mode === "ai" && (
          <div className="space-y-2 rounded-md border p-3">
            <label className="font-medium">AI 图解风格与张数</label>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={aiStyle} onChange={(e) => setAiStyle(e.target.value)} className="w-56">
                {AI_ILLUSTRATE_STYLES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </Select>
              <Select
                value={String(count)}
                onChange={(e) => setCount(Number(e.target.value))}
                className="w-32"
              >
                {Array.from({ length: MAX_AI_ILLUSTRATIONS }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    每篇 {n} 张
                  </option>
                ))}
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              {resolveAiIllustrateStyle(aiStyle).hint}
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-500">
              注意：AI 生图一张真金白银，且每张要 30-60 秒。张数给大了，生文这一步会明显变慢，
              极端情况可能撞上函数 5 分钟上限（撞上了正文照常出，只是配图缺几张）。
            </p>
          </div>
        )}

        {/* ③ 封面风格 */}
        <div className="space-y-2">
          <label className="font-medium">封面默认风格</label>
          <div className="flex flex-wrap gap-2">
            {COVER_STYLES.map((s) => (
              <button
                key={s.key}
                type="button"
                title={`${s.hint}｜适合：${s.bestFor.join("、")}`}
                onClick={() => setCoverStyle(s.key)}
                className={
                  "rounded-md border px-3 py-1.5 text-sm transition-colors " +
                  (coverStyle === s.key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:bg-accent")
                }
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {cover.hint}　默认比例 {cover.defaultRatio}｜适合：{cover.bestFor.join("、")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            disabled={saving}
            onClick={() =>
              save({
                illustrateMode: mode,
                aiIllustrateStyle: aiStyle,
                aiIllustrateCount: count,
                coverStyle,
              })
            }
          >
            {saving ? "保存中…" : "保存"}
          </Button>
          {msg && <span className="text-muted-foreground">{msg}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
