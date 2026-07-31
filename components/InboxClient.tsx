"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { BulkImportPanel } from "@/components/BulkImportPanel";
import {
  SOURCE_LABELS,
  MATERIAL_STATUS_LABELS,
  TOPIC_STATUS_LABELS,
  type Topic,
  type Material,
} from "@/lib/types";
import type { MaterialCard } from "@/lib/queries";
import { formatRelativeTime } from "@/lib/format";
import {
  ExternalLink,
  Ban,
  Sparkles,
  Link2,
  Clock,
  Shuffle,
  X,
  Plus,
  Undo2,
} from "lucide-react";

interface Props {
  materials: MaterialCard[];
  /** 活跃选题（idea/selected/drafting，按 updated_at 倒序），服务端已过滤好 */
  topics: Topic[];
  /** 文案引擎是否已配置（控制「AI 建议角度」按钮） */
  llmEnabled: boolean;
}

const PAGE_SIZE = 60;

// 排序模式：最新优先（默认）/ 最近乱序
type SortMode = "time" | "shuffle";

const SORT_LABELS: Record<SortMode, string> = {
  time: "最新优先",
  shuffle: "最近乱序",
};

// 乱序模式只打乱最近 7 天入库的素材，避免翻出陈年旧料
const SHUFFLE_WINDOW_MS = 7 * 86400_000;

// 状态筛选的特殊值：「未处理」= new + shortlisted（默认视图收噪音，忽略/已用/过期要主动选）
const STATUS_UNHANDLED = "unhandled";

// 忽略后的撤销窗口：卡片原地变「已忽略 · 撤销」条，超时后从默认视图消失
const UNDO_WINDOW_MS = 5000;

// 素材的展示时间：优先原文发布时间，缺失时退回入库时间（排序按此取值）
function materialTime(m: MaterialCard): number {
  const iso = m.published_at ?? m.created_at;
  return iso ? new Date(iso).getTime() : 0;
}

// 带种子的洗牌（mulberry32 + Fisher-Yates）：同一种子渲染多次顺序稳定，点"换个顺序"才重排
function seededShuffle<T>(arr: T[], seed: number): T[] {
  let s = (seed >>> 0) || 1;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function InboxClient({ materials, topics, llmEnabled }: Props) {
  const router = useRouter();
  // 本地持有素材副本，忽略/入选/新增可乐观更新，无需整页刷新
  const [list, setList] = useState<MaterialCard[]>(materials);
  const [source, setSource] = useState("");
  const [pillar, setPillar] = useState("");
  const [status, setStatus] = useState(STATUS_UNHANDLED);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState(""); // 防抖后的生效搜索词
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [sort, setSort] = useState<SortMode>("time");
  // 乱序种子与时间窗截点：切到乱序/点"换个顺序"时才在事件里更新（渲染期不取 Date.now，保持纯净）
  const [shuffleSeed, setShuffleSeed] = useState(1);
  const [shuffleCutoff, setShuffleCutoff] = useState(0);
  const [promote, setPromote] = useState<MaterialCard | null>(null);
  const [attach, setAttach] = useState<MaterialCard | null>(null);
  const [detail, setDetail] = useState<MaterialCard | null>(null);
  const [adding, setAdding] = useState(false);
  // 刚被忽略、还在撤销窗口内的素材 id 集合（默认视图里以「已忽略 · 撤销」条形式保留）
  const [undoable, setUndoable] = useState<Set<string>>(new Set());
  const undoTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // 轻量提示条（请求失败/次要警告用）
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 组件卸载时清掉所有挂起的定时器
  useEffect(() => {
    const timers = undoTimers.current;
    return () => {
      timers.forEach(clearTimeout);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  // 搜索即时化：输入 150ms 防抖后直接生效，无需点按钮提交
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(q);
      setVisible(PAGE_SIZE);
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }

  // 板块筛选选项：从当前素材列表里收集非空板块去重（板块是自由分类字符串，没有固定枚举）
  const pillarOptions = useMemo(() => {
    const set = new Set<string>();
    for (const m of list) if (m.pillar) set.add(m.pillar);
    return Array.from(set);
  }, [list]);

  // 客户端瞬时筛选：来源 / 板块 / 状态 / 关键词全在内存里过滤，零往返
  const filtered = useMemo(() => {
    const kw = query.trim().toLowerCase();
    return list.filter((m) => {
      if (source && m.source !== source) return false;
      if (pillar && m.pillar !== pillar) return false;
      if (status === STATUS_UNHANDLED) {
        // 默认视图只看未处理（new + shortlisted）；撤销窗口内的忽略条原地保留
        const unhandled = m.status === "new" || m.status === "shortlisted";
        if (!unhandled && !undoable.has(m.id)) return false;
      } else if (status && m.status !== status) {
        return false;
      }
      if (kw) {
        const hay = `${m.title ?? ""} ${m.title_en ?? ""} ${m.summary ?? ""}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [list, source, pillar, status, query, undoable]);

  // 展示顺序：最新优先按（发布时间→入库时间）倒序；
  // 最近乱序只取近 7 天入库的随机打乱（不足时退回全量打乱），换个角度刷灵感
  const sorted = useMemo(() => {
    if (sort === "shuffle") {
      const recent = filtered.filter((m) => new Date(m.created_at).getTime() >= shuffleCutoff);
      return seededShuffle(recent.length > 0 ? recent : filtered, shuffleSeed);
    }
    return [...filtered].sort((a, b) => materialTime(b) - materialTime(a));
  }, [filtered, sort, shuffleSeed, shuffleCutoff]);

  const shown = sorted.slice(0, visible);

  // 任一筛选变化时重置分页
  function resetPaging() {
    setVisible(PAGE_SIZE);
  }

  function setMaterialStatus(id: string, s: MaterialCard["status"]) {
    setList((prev) => prev.map((x) => (x.id === id ? { ...x, status: s } : x)));
  }

  async function ignore(m: MaterialCard) {
    const prevStatus = m.status;
    // 乐观更新：先本地标为忽略并进入撤销窗口，再落库
    setMaterialStatus(m.id, "ignored");
    setUndoable((prev) => new Set(prev).add(m.id));
    let ok = false;
    try {
      const res = await fetch("/api/materials", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: m.id, status: "ignored" }),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    if (!ok) {
      // 失败回滚：恢复原状态、撤掉忽略条
      setMaterialStatus(m.id, prevStatus);
      setUndoable((prev) => {
        const next = new Set(prev);
        next.delete(m.id);
        return next;
      });
      showToast("忽略失败，已恢复");
      return;
    }
    // 撤销窗口计时：超时后从默认视图消失
    const t = setTimeout(() => {
      undoTimers.current.delete(m.id);
      setUndoable((prev) => {
        const next = new Set(prev);
        next.delete(m.id);
        return next;
      });
    }, UNDO_WINDOW_MS);
    undoTimers.current.set(m.id, t);
  }

  async function undoIgnore(m: MaterialCard) {
    // 先停掉消失倒计时，撤销失败时忽略条留着可重试
    const t = undoTimers.current.get(m.id);
    if (t) {
      clearTimeout(t);
      undoTimers.current.delete(m.id);
    }
    let ok = false;
    try {
      const res = await fetch("/api/materials", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: m.id, status: "new" }),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    if (ok) {
      setMaterialStatus(m.id, "new");
      setUndoable((prev) => {
        const next = new Set(prev);
        next.delete(m.id);
        return next;
      });
    } else {
      showToast("撤销失败，请重试");
    }
  }

  // 选题创建成功后的收尾：素材标已入选（失败只提示不阻断）、跳转选题页
  async function handlePromoted(materialId: string, topicId: string | null) {
    setPromote(null);
    let ok = false;
    try {
      const res = await fetch("/api/materials", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: materialId, status: "shortlisted" }),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    if (ok) setMaterialStatus(materialId, "shortlisted");
    else showToast("选题已创建，但素材状态更新失败");
    if (topicId) router.push(`/topics/${topicId}`);
  }

  // 挂载成功后的收尾：素材标已入选（失败只提示不阻断）
  async function handleAttached(materialId: string) {
    setAttach(null);
    let ok = false;
    try {
      const res = await fetch("/api/materials", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: materialId, status: "shortlisted" }),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    if (ok) {
      setMaterialStatus(materialId, "shortlisted");
      showToast("已挂到选题");
    } else {
      showToast("已挂到选题，但素材状态更新失败");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            resetPaging();
          }}
          className="w-36"
        >
          <option value="">全部来源</option>
          {Object.entries(SOURCE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </Select>
        <Select
          value={pillar}
          onChange={(e) => {
            setPillar(e.target.value);
            resetPaging();
          }}
          className="w-32"
        >
          <option value="">全部板块</option>
          {pillarOptions.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </Select>
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            resetPaging();
          }}
          className="w-32"
        >
          <option value={STATUS_UNHANDLED}>未处理</option>
          <option value="">全部状态</option>
          {Object.entries(MATERIAL_STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </Select>
        <Select
          value={sort}
          onChange={(e) => {
            const next = e.target.value as SortMode;
            setSort(next);
            if (next === "shuffle") {
              setShuffleSeed(Math.floor(Math.random() * 2 ** 31) || 1);
              setShuffleCutoff(Date.now() - SHUFFLE_WINDOW_MS);
            }
            resetPaging();
          }}
          className="w-32"
        >
          {Object.entries(SORT_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </Select>
        {sort === "shuffle" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setShuffleSeed(Math.floor(Math.random() * 2 ** 31) || 1);
              setShuffleCutoff(Date.now() - SHUFFLE_WINDOW_MS);
              resetPaging();
            }}
          >
            <Shuffle /> 换个顺序
          </Button>
        )}
        <div className="relative">
          <Input
            placeholder="搜索关键词…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-48 pr-8"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="清空搜索"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus /> 添加素材
        </Button>
        <span className="text-sm text-muted-foreground">
          共 {sorted.length} 条{sort === "shuffle" && sorted.length < filtered.length ? "（近 7 天）" : ""}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((m) =>
          undoable.has(m.id) ? (
            // 撤销窗口内的忽略条：原地保留 5 秒，点撤销即恢复
            <Card key={m.id} className="border-dashed">
              <CardContent className="flex items-center justify-between gap-2 p-4">
                <span className="line-clamp-1 text-sm text-muted-foreground">
                  已忽略「{m.title || "无标题"}」
                </span>
                <Button size="sm" variant="outline" onClick={() => undoIgnore(m)}>
                  <Undo2 /> 撤销
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card key={m.id} className="flex flex-col">
              <CardContent className="flex flex-1 flex-col gap-2 p-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary">{SOURCE_LABELS[m.source]}</Badge>
                  {m.pillar && <Badge variant="outline">{m.pillar}</Badge>}
                  {m.status !== "new" && <Badge variant="muted">{MATERIAL_STATUS_LABELS[m.status]}</Badge>}
                  {materialTime(m) > 0 && (
                    <span
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                      title={new Date(materialTime(m)).toLocaleString()}
                      suppressHydrationWarning
                    >
                      <Clock className="size-3" /> {formatRelativeTime(m.published_at ?? m.created_at)}
                    </span>
                  )}
                </div>
                {/* 标题可点：弹全文详情，读完即决策 */}
                <h3
                  className="cursor-pointer font-medium leading-snug hover:underline"
                  role="button"
                  tabIndex={0}
                  onClick={() => setDetail(m)}
                  onKeyDown={(e) => e.key === "Enter" && setDetail(m)}
                >
                  {m.title || "无标题"}
                </h3>
                {m.summary && (
                  <p className="line-clamp-3 text-sm text-muted-foreground">{m.summary}</p>
                )}
                {m.url && (
                  <a
                    href={m.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="size-3" /> 原文
                  </a>
                )}
                <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
                  <Button size="sm" onClick={() => setPromote(m)}>
                    <Sparkles /> 立为选题
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setAttach(m)}>
                    <Link2 /> 挂到选题
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => ignore(m)}>
                    <Ban /> 忽略
                  </Button>
                </div>
              </CardContent>
            </Card>
          ),
        )}
        {sorted.length === 0 && (
          <p className="col-span-full py-12 text-center text-muted-foreground">
            没有符合条件的素材。
          </p>
        )}
      </div>

      {visible < sorted.length && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
            显示更多（还有 {sorted.length - visible} 条）
          </Button>
        </div>
      )}

      {promote && (
        <PromoteDialog
          material={promote}
          llmEnabled={llmEnabled}
          onClose={() => setPromote(null)}
          onSuccess={handlePromoted}
        />
      )}
      {attach && (
        <AttachDialog
          material={attach}
          topics={topics}
          onClose={() => setAttach(null)}
          onSuccess={handleAttached}
        />
      )}
      {detail && (
        <DetailDialog
          material={detail}
          onClose={() => setDetail(null)}
          onPromote={(m) => {
            setDetail(null);
            setPromote(m);
          }}
          onAttach={(m) => {
            setDetail(null);
            setAttach(m);
          }}
        />
      )}
      {adding && (
        <AddMaterialDialog
          pillarOptions={pillarOptions}
          onClose={() => setAdding(false)}
          onCreated={(m) => {
            // 乐观插到列表顶部，立刻可见
            setList((prev) => [m, ...prev]);
            setAdding(false);
            showToast("素材已添加");
          }}
          onBulkCreated={(list) => {
            // 批量导入：每批回来就插到顶部（弹窗不关，可继续导），按 id 去重防重复插入
            setList((prev) => {
              const known = new Set(prev.map((x) => x.id));
              const fresh = list.filter((m) => !known.has(m.id));
              return fresh.length > 0 ? [...fresh, ...prev] : prev;
            });
            showToast(`已导入 ${list.length} 条素材`);
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-md bg-foreground px-3 py-2 text-sm text-background shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

// ===== 弹窗组件（顶层定义，避免随父组件重渲染被重挂载丢输入状态）=====

interface AngleSuggestion {
  angle: string;
  why: string;
}

function PromoteDialog({
  material,
  llmEnabled,
  onClose,
  onSuccess,
}: {
  material: MaterialCard;
  llmEnabled: boolean;
  onClose: () => void;
  onSuccess: (materialId: string, topicId: string | null) => void;
}) {
  // 切入角度默认取素材标题（一句话即角度），可直接改或点 AI 建议替换
  const [angle, setAngle] = useState(material.title ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<AngleSuggestion[] | null>(null);

  // AI 建议角度：DeepSeek 产出 3 个差异化切入角度，点选即填入可再改
  async function suggest() {
    setSuggesting(true);
    setError(null);
    try {
      const res = await fetch("/api/suggest-angle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ material_id: material.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "生成建议失败");
      setSuggestions(data?.suggestions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成建议失败");
    } finally {
      setSuggesting(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: material.title,
          angle,
          pillar: material.pillar,
          material_ids: [material.id],
          status: "selected",
        }),
      });
      const data = await res.json().catch(() => null);
      // 创建失败不关弹窗、不动素材状态，保住用户填好的角度文本
      if (!res.ok || !data?.topic) throw new Error(data?.error || "创建选题失败，请重试");
      onSuccess(material.id, data.topic.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建选题失败，请重试");
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onClose} className="max-h-[85vh] overflow-y-auto">
      <h2 className="mb-1 text-lg font-semibold">立为选题</h2>
      <p className="mb-4 text-sm text-muted-foreground">{material.title}</p>
      <div className="space-y-3">
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <label className="block text-sm font-medium">切入角度（一句话）</label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={suggest}
              disabled={!llmEnabled || suggesting}
              title={llmEnabled ? "让 DeepSeek 给 3 个差异化切入角度" : "未配置文案引擎，先去设置页配置"}
            >
              <Sparkles /> {suggesting ? "生成中…" : "AI 建议角度"}
            </Button>
          </div>
          <Textarea
            value={angle}
            onChange={(e) => setAngle(e.target.value)}
            placeholder="例：AI 的记忆功能到底解决了什么问题——普通用户能感知到差别吗？"
          />
          {suggestions && suggestions.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setAngle(s.angle)}
                  className="block w-full rounded-md border p-2 text-left text-sm hover:bg-muted"
                >
                  <span className="font-medium">{s.angle}</span>
                  {s.why && <span className="mt-0.5 block text-xs text-muted-foreground">{s.why}</span>}
                </button>
              ))}
            </div>
          )}
          {suggestions && suggestions.length === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">没有生成出可用的角度，再点一次试试。</p>
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={save} disabled={saving || !angle}>
            {saving ? "创建中…" : "创建选题"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function AttachDialog({
  material,
  topics,
  onClose,
  onSuccess,
}: {
  material: MaterialCard;
  topics: Topic[];
  onClose: () => void;
  onSuccess: (materialId: string) => void;
}) {
  const [topicId, setTopicId] = useState(topics[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!topicId) return;
    setSaving(true);
    setError(null);
    try {
      // 只传新增 id，服务端原子追加——绝不整体覆盖 material_ids，连挂多条不丢数据
      const res = await fetch(`/api/topics/${topicId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ add_material_ids: [material.id] }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "挂载失败，请重试");
      }
      onSuccess(material.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "挂载失败，请重试");
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onClose}>
      <h2 className="mb-1 text-lg font-semibold">挂到已有选题</h2>
      <p className="mb-4 text-sm text-muted-foreground">{material.title}</p>
      {topics.length === 0 ? (
        <p className="text-sm text-muted-foreground">没有活跃中的选题，先「立为选题」。</p>
      ) : (
        <div className="space-y-3">
          <Select value={topicId} onChange={(e) => setTopicId(e.target.value)}>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {(t.title || t.angle || "未命名") + " · " + TOPIC_STATUS_LABELS[t.status]}
              </option>
            ))}
          </Select>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>取消</Button>
            <Button onClick={save} disabled={saving}>{saving ? "挂载中…" : "挂载"}</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

// 全文详情弹窗：按需拉完整素材（含 content 大字段），读完即决策
function DetailDialog({
  material,
  onClose,
  onPromote,
  onAttach,
}: {
  material: MaterialCard;
  onClose: () => void;
  onPromote: (m: MaterialCard) => void;
  onAttach: (m: MaterialCard) => void;
}) {
  const [full, setFull] = useState<Material | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/materials/${material.id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (alive) setFull(data.material);
      })
      .catch(() => {
        if (alive) setError("全文加载失败，可点原文链接直接看");
      });
    return () => {
      alive = false;
    };
  }, [material.id]);

  const loading = !full && !error;

  return (
    <Dialog open onClose={onClose} className="max-w-2xl">
      <div className="mb-2 flex flex-wrap items-center gap-1.5 pr-6">
        <Badge variant="secondary">{SOURCE_LABELS[material.source]}</Badge>
        {material.pillar && <Badge variant="outline">{material.pillar}</Badge>}
        {material.status !== "new" && (
          <Badge variant="muted">{MATERIAL_STATUS_LABELS[material.status]}</Badge>
        )}
      </div>
      <h2 className="mb-3 text-lg font-semibold leading-snug">{material.title || "无标题"}</h2>

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}
      {error && <p className="text-sm text-muted-foreground">{error}</p>}
      {full && (
        <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1 text-sm">
          {full.summary && <p className="text-muted-foreground">{full.summary}</p>}
          {full.content ? (
            <p className="whitespace-pre-wrap leading-relaxed">{full.content}</p>
          ) : (
            !full.summary && <p className="text-muted-foreground">该素材没有正文内容。</p>
          )}
          {full.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {full.tags.map((t) => (
                <Badge key={t} variant="muted">{t}</Badge>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t pt-3">
        <Button size="sm" onClick={() => onPromote(material)}>
          <Sparkles /> 立为选题
        </Button>
        <Button size="sm" variant="outline" onClick={() => onAttach(material)}>
          <Link2 /> 挂到选题
        </Button>
        {material.url && (
          <a
            href={material.url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="size-3" /> 原文链接
          </a>
        )}
      </div>
    </Dialog>
  );
}

// 添加素材弹窗：两个标签页——
//   手动录入：标题必填，url 服务端按链接去重（重复报 409）
//   批量导入：选/拖一个本地文件夹（Obsidian vault 等），浏览器本地解析后分批入库
function AddMaterialDialog({
  pillarOptions,
  onClose,
  onCreated,
  onBulkCreated,
}: {
  /** 板块联想候选（当前列表里已有的分类名去重） */
  pillarOptions: string[];
  onClose: () => void;
  onCreated: (m: MaterialCard) => void;
  /** 批量导入每批成功后回调（弹窗保持打开，可以继续导下一个文件夹） */
  onBulkCreated: (list: MaterialCard[]) => void;
}) {
  const [tab, setTab] = useState<"manual" | "bulk">("manual");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [pillar, setPillar] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          url: url || undefined,
          summary: summary || undefined,
          content: content || undefined,
          pillar: pillar || undefined,
          // 标签支持中英文逗号/空格分隔
          tags: tags.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean),
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 409) throw new Error("该链接的素材已存在");
      if (!res.ok || !data?.material) throw new Error(data?.error || "添加失败，请重试");
      onCreated(data.material as MaterialCard);
    } catch (e) {
      setError(e instanceof Error ? e.message : "添加失败，请重试");
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      className={`max-h-[85vh] overflow-y-auto ${tab === "bulk" ? "max-w-2xl" : ""}`}
    >
      <h2 className="mb-3 text-lg font-semibold">添加素材</h2>
      <div className="mb-4 flex gap-1 rounded-lg bg-muted p-1 text-sm">
        {([
          ["manual", "手动录入"],
          ["bulk", "批量导入"],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`flex-1 rounded-md px-3 py-1.5 transition-colors ${
              tab === k ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "bulk" ? (
        <BulkImportPanel pillarOptions={pillarOptions} onImported={onBulkCreated} onClose={onClose} />
      ) : (
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium">标题 *</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="素材标题" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">原文链接</label>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…（可选，按链接去重）" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">摘要</label>
          <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="一两句话说这是什么（可选）" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">正文</label>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="粘贴正文/要点（可选）"
            className="min-h-24"
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">板块</label>
            {/* 自由分类：文本输入 + datalist 联想已有分类名 */}
            <Input
              value={pillar}
              onChange={(e) => setPillar(e.target.value)}
              placeholder="素材分类，如：AI 资讯（可选）"
              list="material-pillar-options"
            />
            <datalist id="material-pillar-options">
              {pillarOptions.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">标签</label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="逗号分隔（可选）" />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={save} disabled={saving || !title.trim()}>
            {saving ? "添加中…" : "添加"}
          </Button>
        </div>
      </div>
      )}
    </Dialog>
  );
}
