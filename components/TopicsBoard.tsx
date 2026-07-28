"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  TOPIC_STATUS_LABELS,
  type Topic,
  type TopicStatus,
} from "@/lib/types";
import { ChevronRight, ChevronLeft, AlertTriangle } from "lucide-react";

const ORDER: TopicStatus[] = ["idea", "selected", "drafting", "done", "dropped"];

export function TopicsBoard({ topics }: { topics: Topic[] }) {
  const router = useRouter();
  // 本地副本做乐观更新：先挪列再 PATCH，失败回滚
  const [items, setItems] = useState<Topic[]>(topics);
  // 正在移动中的选题 id 集合（禁用按钮防连点）
  const [moving, setMoving] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  // 服务端刷新后同步真实数据（渲染期比对 props，避免 effect 级联渲染）
  const [prevTopics, setPrevTopics] = useState(topics);
  if (prevTopics !== topics) {
    setPrevTopics(topics);
    setItems(topics);
  }

  async function move(topic: Topic, dir: 1 | -1) {
    const idx = ORDER.indexOf(topic.status);
    const next = ORDER[idx + dir];
    if (!next || moving.has(topic.id)) return;
    setError("");
    // 乐观更新：立即挪列
    setItems((cur) => cur.map((t) => (t.id === topic.id ? { ...t, status: next } : t)));
    setMoving((cur) => new Set(cur).add(topic.id));
    try {
      const res = await fetch(`/api/topics/${topic.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      // 失败回滚到原状态（按 id 精确还原，避免覆盖其他并发移动）
      setItems((cur) => cur.map((t) => (t.id === topic.id ? { ...t, status: topic.status } : t)));
      setError("移动失败，已还原，请稍后重试。");
    } finally {
      setMoving((cur) => {
        const s = new Set(cur);
        s.delete(topic.id);
        return s;
      });
    }
  }

  const byStatus = (s: TopicStatus) => items.filter((t) => t.status === s);

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" /> {error}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {ORDER.map((status) => {
          const list = byStatus(status);
          return (
            <div key={status} className="rounded-xl border bg-card/50 p-2">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-semibold">{TOPIC_STATUS_LABELS[status]}</span>
                <Badge variant="muted">{list.length}</Badge>
              </div>
              <div className="space-y-2">
                {list.map((t) => {
                  const idx = ORDER.indexOf(t.status);
                  const busy = moving.has(t.id);
                  return (
                    <div key={t.id} className="rounded-lg border bg-card p-2.5 shadow-sm">
                      <Link href={`/topics/${t.id}`} className="block hover:underline">
                        <div className="text-sm font-medium leading-snug">
                          {t.title || t.angle || "未命名选题"}
                        </div>
                      </Link>
                      {t.angle && t.title && (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{t.angle}</p>
                      )}
                      <div className="mt-2 flex items-center justify-between">
                        {t.pillar ? (
                          <Badge variant="outline">{t.pillar}</Badge>
                        ) : (
                          <span />
                        )}
                        <div className="flex gap-0.5">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-6"
                            disabled={idx === 0 || busy}
                            onClick={() => move(t, -1)}
                          >
                            <ChevronLeft className="size-3" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-6"
                            disabled={idx === ORDER.length - 1 || busy}
                            onClick={() => move(t, 1)}
                          >
                            <ChevronRight className="size-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {list.length === 0 && (
                  <p className="px-1 py-4 text-center text-xs text-muted-foreground">空</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
