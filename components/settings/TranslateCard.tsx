"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SourceBadge, useSectionSave } from "./shared";
import { LLM_PROVIDERS, LLM_PROVIDER_IDS, type LlmProvider } from "@/lib/llm-providers";

// 素材翻译引擎：RSS 等英文素材的标题+摘要自动译中文。
// 与「文案生成引擎」相互独立——写稿可以用旗舰模型，翻译用便宜的 flash 就够。
// key 不单独配：复用所选引擎在文案引擎卡片里已存的那把（一把 key 存一份）。
export function TranslateCard({
  enabled,
  keyConfigured,
  provider: initialProvider,
  model: initialModel,
}: {
  enabled: boolean;
  /** 所选引擎是否已有可用 key（决定右上角徽章） */
  keyConfigured: boolean;
  provider: LlmProvider;
  model: string;
}) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [provider, setProvider] = useState<LlmProvider>(initialProvider);
  const [model, setModel] = useState(initialModel);
  const { saving, msg, save } = useSectionSave();
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState("");

  // 立即翻译：把收件箱里还没翻的英文素材现在就翻掉（也是连通性测试）
  async function runNow() {
    setRunning(true);
    setRunMsg("");
    try {
      const res = await fetch("/api/translate", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setRunMsg(`翻译失败：${data.error || "未知错误"}`);
      } else if (data.skipped) {
        setRunMsg(`已跳过：${data.skipped}`);
      } else if (data.candidates === 0) {
        setRunMsg("当前没有待翻译的英文素材 ✓");
      } else {
        setRunMsg(
          `候选 ${data.candidates} 条，翻译成功 ${data.translated} 条${data.failed ? `，失败 ${data.failed} 条（保留英文，下轮重试）` : ""} ✓`,
        );
        router.refresh();
      }
    } catch {
      setRunMsg("翻译失败：网络错误");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">素材翻译引擎</CardTitle>
        <SourceBadge enabled={keyConfigured} source="db" />
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} className="size-4" />
          <span>自动把英文素材（RSS 等）的标题和摘要翻译成中文</span>
        </label>

        <div className="space-y-1">
          <label className="text-muted-foreground">翻译用哪家引擎（key 复用文案引擎卡片里已存的）</label>
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
          <label className="text-muted-foreground">翻译模型（用轻量快速的就够，不用旗舰）</label>
          <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-v4-flash" />
        </div>

        <p className="text-xs text-muted-foreground">
          采集入库后批量执行：中文写入标题/摘要，英文原文保留在 title_en。每批 ≤20 条按 id 对应防错位；
          翻译失败的条目保留英文原样，下轮采集自动重试。这个量级下 flash 模型月成本约几元。
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            disabled={saving}
            onClick={() => save({ translateEnabled: on, translateProvider: provider, translateModel: model })}
          >
            {saving ? "保存中…" : "保存"}
          </Button>
          <Button size="sm" variant="outline" disabled={running} onClick={runNow}>
            {running ? "翻译中…" : "立即翻译"}
          </Button>
          {msg && <span className="text-muted-foreground">{msg}</span>}
        </div>
        {runMsg && (
          <p className={`text-xs break-all ${runMsg.endsWith("✓") ? "text-green-600" : "text-red-500"}`}>
            {runMsg}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
