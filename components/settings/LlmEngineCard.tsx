"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KeyInput, SourceBadge, useSectionSave } from "./shared";
import {
  LLM_PROVIDERS,
  LLM_PROVIDER_IDS,
  modelOptionLabel,
  structuredNote,
  type LlmProvider,
} from "@/lib/llm-providers";

// 某一家引擎在设置页里的可编辑状态
export interface ProviderState {
  apiKey: string;
  model: string;
}

// 文案生成引擎：DeepSeek / 通义千问 / Kimi / 云雾 API 四选一。
// 一把 key 通常能调该家多个模型，所以模型不写死：点「获取模型」实时拉 /models 再下拉选，
// 拉不动（限流/新模型未上架）也能切回手动输入，不至于被下拉框锁死。
export function LlmEngineCard({
  enabled,
  source,
  provider: initialProvider,
  providers: initialProviders,
}: {
  enabled: boolean;
  source: "db" | "env" | "none";
  provider: LlmProvider;
  providers: Record<LlmProvider, ProviderState>;
}) {
  const [provider, setProvider] = useState<LlmProvider>(initialProvider);
  const [providers, setProviders] = useState(initialProviders);
  const { saving, msg, save } = useSectionSave();
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState("");
  // 拉到的模型列表按引擎分别缓存：切来切去不用重复拉
  const [modelList, setModelList] = useState<Partial<Record<LlmProvider, string[]>>>({});
  const [loadingModels, setLoadingModels] = useState(false);
  // 手动输入兜底：拉取失败或想填列表里没有的模型时切回文本框
  const [manual, setManual] = useState(false);

  const meta = LLM_PROVIDERS[provider];
  const cur = providers[provider];
  const models = modelList[provider];
  // 所选模型结构化不可靠时，把「实际写稿的是谁」摆到明面上，而不是藏在灰色小字里
  const note = structuredNote(provider, cur.model);

  function patchCur(p: Partial<ProviderState>) {
    setProviders((s) => ({ ...s, [provider]: { ...s[provider], ...p } }));
  }

  // 一键获取当前引擎公开的模型列表（输入框里未保存的 key 优先，空则后端用已存/env 的 key）
  async function loadModels() {
    setLoadingModels(true);
    setTestMsg("");
    try {
      const res = await fetch("/api/config/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: cur.apiKey || undefined }),
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.models) && data.models.length > 0) {
        setModelList((s) => ({ ...s, [provider]: data.models }));
        setManual(false);
        // 当前模型不在列表里（换了家或模型已下架）→ 自动选中第一个，避免存下一个调不通的模型
        if (!data.models.includes(cur.model)) patchCur({ model: data.models[0] });
        setTestMsg(`获取到 ${data.models.length} 个模型 ✓`);
      } else if (data.ok) {
        setTestMsg("获取成功，但该 key 下没有可用的对话模型");
      } else {
        setTestMsg(`获取失败：${data.error || "未知错误"}`);
      }
    } catch {
      setTestMsg("获取失败：网络错误");
    } finally {
      setLoadingModels(false);
    }
  }

  // 连通性测试：输入框里未保存的值优先，空则后端用当前生效配置
  async function testConn() {
    setTesting(true);
    setTestMsg("");
    try {
      const res = await fetch("/api/config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "llm", provider, apiKey: cur.apiKey || undefined }),
      });
      const data = await res.json();
      setTestMsg(data.ok ? "连接成功 ✓" : `连接失败：${data.error || "未知错误"}`);
    } catch {
      setTestMsg("连接失败：网络错误");
    } finally {
      setTesting(false);
    }
  }

  // 保存：提供方 + 三家各自的 key/model 一起提交（key 为空串跳过，避免误清已存的）
  function onSave() {
    const patch: Record<string, unknown> = { llmProvider: provider };
    for (const id of LLM_PROVIDER_IDS) {
      const m = LLM_PROVIDERS[id];
      if (providers[id].apiKey) patch[m.keyField] = providers[id].apiKey;
      if (providers[id].model) patch[m.modelField] = providers[id].model;
    }
    save(patch);
  }

  const ok = testMsg.startsWith("连接成功") || testMsg.startsWith("获取到");

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">文案生成引擎</CardTitle>
        <SourceBadge enabled={enabled} source={source} />
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="space-y-1">
          <label className="text-muted-foreground">当前引擎（保存后所有 AI 文案功能都走它）</label>
          <div className="flex flex-wrap gap-2">
            {LLM_PROVIDER_IDS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setProvider(id);
                  setTestMsg("");
                  setManual(false);
                }}
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
          <label className="text-muted-foreground">{meta.keyLabel}</label>
          <KeyInput value={cur.apiKey} onChange={(v) => patchCur({ apiKey: v })} placeholder="sk-..." />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label className="text-muted-foreground">模型</label>
            <div className="flex items-center gap-2">
              {models && models.length > 0 && (
                <button
                  type="button"
                  onClick={() => setManual((m) => !m)}
                  className="text-xs text-blue-500 hover:underline"
                >
                  {manual ? "从列表选" : "手动输入"}
                </button>
              )}
              <Button size="sm" variant="outline" disabled={loadingModels} onClick={loadModels}>
                {loadingModels ? "获取中…" : "获取模型"}
              </Button>
            </div>
          </div>
          {models && models.length > 0 && !manual ? (
            <select
              value={cur.model}
              onChange={(e) => patchCur({ model: e.target.value })}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {/* 当前值不在列表里也要能显示，否则 select 会静默跳到第一项 */}
              {!models.includes(cur.model) && <option value={cur.model}>{cur.model}（当前）</option>}
              {models.map((m) => (
                <option key={m} value={m}>
                  {modelOptionLabel(provider, m)}
                </option>
              ))}
            </select>
          ) : (
            <Input
              value={cur.model}
              onChange={(e) => patchCur({ model: e.target.value })}
              placeholder={meta.defaultModel}
            />
          )}
          {note && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-400">
              ⚠️ 写稿的不是它：{note.text}
            </p>
          )}
          <p className="text-xs text-muted-foreground">{meta.modelHint}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={saving} onClick={onSave}>
            {saving ? "保存中…" : "保存"}
          </Button>
          <Button size="sm" variant="outline" disabled={testing} onClick={testConn}>
            {testing ? "测试中…" : "测试连接"}
          </Button>
          {msg && <span className="text-muted-foreground">{msg}</span>}
          <a
            href={meta.consoleUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-blue-500 hover:underline"
          >
            用量 / 充值 ↗
          </a>
        </div>
        {testMsg && (
          <p className={`text-xs break-all ${ok ? "text-green-600" : "text-red-500"}`}>{testMsg}</p>
        )}
      </CardContent>
    </Card>
  );
}
