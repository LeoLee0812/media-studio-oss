"use client";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Save, Undo2, ChevronDown, ChevronRight } from "lucide-react";

export interface PromptItem {
  id: string;
  label: string;
  group: string;
  description: string;
  defaultText: string;
  override: string | null;
}

// 单条提示词的编辑卡片：折叠展示，展开后可编辑、保存、恢复默认
function PromptCard({ item }: { item: PromptItem }) {
  const [open, setOpen] = useState(false);
  // 当前文本：覆盖值优先，默认值兜底；savedText 记录最近一次已保存的基线，用于判断是否有未保存修改
  const [text, setText] = useState(item.override ?? item.defaultText);
  const [savedText, setSavedText] = useState(item.override ?? item.defaultText);
  const [overridden, setOverridden] = useState(item.override !== null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const dirty = text !== savedText;

  async function save(content: string) {
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/prompts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "保存失败");
      const nowOverridden = data.override !== null;
      setOverridden(nowOverridden);
      // 恢复默认时把编辑区同步回默认文本
      const next = nowOverridden ? String(data.override) : item.defaultText;
      setText(next);
      setSavedText(next);
      setMsg(nowOverridden ? "已保存，立即生效" : "已恢复默认");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader
        className="cursor-pointer flex-row items-center justify-between gap-2"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
          <CardTitle className="text-base">{item.label}</CardTitle>
          {overridden && <Badge variant="default">已自定义</Badge>}
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">{item.description}</p>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={Math.min(18, Math.max(6, text.split("\n").length + 1))}
            className="font-mono text-xs leading-relaxed"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={saving || !dirty} onClick={() => save(text)}>
              <Save /> {saving ? "保存中…" : "保存"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={saving || (!overridden && text === item.defaultText)}
              onClick={() => save("")}
            >
              <Undo2 /> 恢复默认
            </Button>
            {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export function PromptsClient({ items }: { items: PromptItem[] }) {
  // 按 group 分组，保持注册表顺序
  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, PromptItem[]>();
    for (const it of items) {
      if (!map.has(it.group)) {
        map.set(it.group, []);
        order.push(it.group);
      }
      map.get(it.group)!.push(it);
    }
    return order.map((g) => ({ group: g, items: map.get(g)! }));
  }, [items]);

  return (
    <div className="space-y-6">
      {groups.map(({ group, items: gi }) => (
        <section key={group} className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">{group}</h2>
          {gi.map((it) => (
            <PromptCard key={it.id} item={it} />
          ))}
        </section>
      ))}
    </div>
  );
}
