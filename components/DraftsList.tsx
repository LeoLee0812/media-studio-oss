"use client";
import { useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  PLATFORM_LABELS,
  DRAFT_STATUS_LABELS,
} from "@/lib/types";
import type { DraftWithTopic } from "@/lib/queries";
import { formatRelativeTime } from "@/lib/format";
import { FileText, Trash2 } from "lucide-react";

// 未知平台兜底：字典查不到就显示原始平台字符串，避免留空白
function platformLabel(p: string): string {
  return (PLATFORM_LABELS as Record<string, string>)[p] ?? p;
}

export function DraftsList({
  drafts,
  filters,
}: {
  drafts: DraftWithTopic[];
  filters: { status?: string; platform?: string; pillar?: string };
}) {
  const router = useRouter();
  // 乐观删除：先从列表隐藏，请求失败再恢复
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(new Set());
  const visible = drafts.filter((d) => !removedIds.has(d.id));

  // 板块筛选选项：从当前列表数据里收集非空板块去重（含当前生效的筛选值，避免选项消失）
  const pillarOptions = Array.from(
    new Set([...drafts.map((d) => d.pillar).filter((p): p is string => !!p),
      ...(filters.pillar ? [filters.pillar] : [])]),
  );

  function setFilter(key: string, value: string) {
    const p = new URLSearchParams(window.location.search);
    if (value) p.set(key, value);
    else p.delete(key);
    router.push(`/drafts?${p.toString()}`);
  }

  async function removeDraft(e: MouseEvent, d: DraftWithTopic) {
    // 阻止触发外层 Link 跳转
    e.preventDefault();
    e.stopPropagation();
    const name = d.title || d.content?.slice(0, 20) || "无标题";
    if (!confirm(`确定删除稿件「${name}」？删除后不可恢复。`)) return;
    setRemovedIds((prev) => new Set(prev).add(d.id));
    try {
      const res = await fetch(`/api/drafts/${d.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.refresh();
    } catch {
      // 失败回滚：把这行恢复回来
      setRemovedIds((prev) => {
        const s = new Set(prev);
        s.delete(d.id);
        return s;
      });
      alert("删除失败，请重试");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={filters.status ?? ""} onChange={(e) => setFilter("status", e.target.value)} className="w-32">
          <option value="">全部状态</option>
          {Object.entries(DRAFT_STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </Select>
        <Select value={filters.platform ?? ""} onChange={(e) => setFilter("platform", e.target.value)} className="w-36">
          <option value="">全部平台</option>
          {Object.entries(PLATFORM_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </Select>
        <Select value={filters.pillar ?? ""} onChange={(e) => setFilter("pillar", e.target.value)} className="w-32">
          <option value="">全部板块</option>
          {pillarOptions.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </Select>
        <span className="text-sm text-muted-foreground">共 {visible.length} 篇</span>
      </div>

      <Card>
        <CardContent className="divide-y p-0">
          {visible.map((d) => (
            <Link
              key={d.id}
              href={`/drafts/${d.id}`}
              className="flex items-center justify-between gap-3 p-3 hover:bg-accent"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-2">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm">{d.title || d.content?.slice(0, 50) || "无标题"}</span>
                </span>
                <span className="flex min-w-0 items-center gap-2 pl-6 text-xs text-muted-foreground">
                  {d.topic_title && <span className="truncate">{d.topic_title}</span>}
                  {/* 相对时间在客户端与服务端可能相差一分钟，抑制水合警告 */}
                  <span className="shrink-0" suppressHydrationWarning>
                    {formatRelativeTime(d.updated_at)}
                  </span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <Badge variant="outline">{platformLabel(d.platform)}</Badge>
                <Badge variant="muted">{DRAFT_STATUS_LABELS[d.status] ?? d.status}</Badge>
                {d.published_url && (
                  <a
                    href={d.published_url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs text-blue-500 hover:underline"
                  >
                    链接
                  </a>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  title="删除稿件"
                  onClick={(e) => removeDraft(e, d)}
                >
                  <Trash2 className="text-destructive" />
                </Button>
              </span>
            </Link>
          ))}
          {visible.length === 0 && (
            <p className="p-8 text-center text-sm text-muted-foreground">暂无稿件。</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
