"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PLATFORM_LABELS, type Draft, type Platform } from "@/lib/types";
import {
  DEFAULT_STYLE,
  STYLE_DEFS,
  getStyleDef,
  normalizeStyle,
  type WritingStyle,
} from "@/lib/styles";
import { runPostDraftTasks } from "@/lib/draft-tasks";
import { Wand2 } from "lucide-react";

// 全面以公众号为中心（2026-07-14 起）：洗稿只出公众号稿，其余平台规范保留在提示词页备用
const PLATFORMS: Platform[] = ["wechat"];

export default function RewritePage() {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  // 板块 = 自由分类字符串（可留空），提交时随素材落库
  const [pillar, setPillar] = useState("");
  const [selected, setSelected] = useState<Platform[]>(["wechat"]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [llmOn, setLlmOn] = useState(true);
  // 写作风格：初始跟随设置页的默认风格，本页可临时改
  const [style, setStyle] = useState<WritingStyle>(DEFAULT_STYLE);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c) => {
        setLlmOn(!!c.llmEnabled);
        setStyle(normalizeStyle(c.writingStyle));
      })
      .catch(() => {});
  }, []);

  function toggle(p: Platform) {
    setSelected((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));
  }

  // 正文出来后的收尾：与选题页共用同一套三路并行编排（lib/draft-tasks.ts）——
  // 配图原图备份（几秒）∥ 封面生图（1-2 分钟）∥ 小红书高亮预热（30-100 秒）。
  // 服务端已把插图 markdown 写进正文、封面提示词写进 meta.cover。
  // 本页只有一行消息位，取封面（最慢也最关键）作为主状态展示。
  async function autoAssets(draft: Draft, topicTitle: string) {
    setMsg("正文已出。配图备份 ∥ 封面生图（1-2 分钟）∥ 小红书高亮预热，三路并行中…");
    let coverMsg = "";
    await runPostDraftTasks(draft, topicTitle, {
      onCoverMsg: (m) => {
        coverMsg = m;
      },
    });
    setMsg(`${coverMsg || "收尾完成"}，正在进入稿件页…`);
  }

  async function run() {
    if (!content.trim() || selected.length === 0) return;
    setLoading(true);
    setMsg("正在理解原文，成稿中，请稍候…");
    try {
      const res = await fetch("/api/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 页面保持精简：真实经历/附加指令输入框已删，
        // 经历留空走「零第一人称实测」的防编造路径（现象解读型骨架）
        body: JSON.stringify({
          content,
          sourceUrl,
          pillar: pillar.trim() || undefined,
          platforms: selected,
          style,
        }),
      });
      const data = await res.json();
      if (res.ok && data.firstDraftId) {
        // 洗稿也走「正文+配图+封面」一条龙：先把配图原图和封面落好，再跳稿件页
        const wechatDraft = (data.drafts as Draft[] | undefined)?.find((d) => d.platform === "wechat");
        if (wechatDraft) await autoAssets(wechatDraft, data.topic?.title ?? "");
        router.push(`/drafts/${data.firstDraftId}`);
      } else if (res.ok) {
        // 一篇都没成：把各平台的失败原因摆出来
        const errs = Object.entries(data.errors ?? {})
          .map(([p, e]) => `${p}: ${String(e).slice(0, 80)}`)
          .join("；");
        setMsg(errs ? `全部平台生成失败——${errs}` : "生成完成但无稿件，去选题页查看：" + (data.topic?.id ?? ""));
      } else {
        setMsg(data.error || "洗稿失败");
      }
    } catch {
      setMsg("洗稿失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold">快速洗稿</h1>
        <p className="text-sm text-muted-foreground">
          粘贴中文或英文原文，直接出公众号稿件。英文会先理解提炼再用中文成稿。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">原文</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            rows={10}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="把要洗的原文粘贴到这里（中文或英文皆可）…"
          />
          <Input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="来源链接（可选，便于标注出处）"
          />
          <div>
            <label className="mb-1 block text-sm font-medium">板块（可选）</label>
            <Input
              value={pillar}
              onChange={(e) => setPillar(e.target.value)}
              placeholder="素材分类，如：AI 资讯"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">写作风格</label>
            <div className="flex flex-wrap gap-2">
              {STYLE_DEFS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStyle(s.id)}
                  className={
                    "rounded-md border px-3 py-1.5 text-sm transition-colors " +
                    (style === s.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-accent")
                  }
                >
                  {s.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">{getStyleDef(style).hint}</p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">目标平台</label>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => toggle(p)}
                  className={
                    "rounded-md border px-3 py-1.5 text-sm transition-colors " +
                    (selected.includes(p)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-accent")
                  }
                >
                  {PLATFORM_LABELS[p]}
                </button>
              ))}
            </div>
          </div>
          {!llmOn && (
            <p className="text-sm text-destructive">未配置 DEEPSEEK_API_KEY，洗稿不可用。</p>
          )}
          <div className="flex items-center gap-3">
            <Button onClick={run} disabled={loading || !llmOn || !content.trim() || selected.length === 0}>
              <Wand2 /> {loading ? "洗稿中…" : "洗稿（正文 + 配图 + 封面）"}
            </Button>
            {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
