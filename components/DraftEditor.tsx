"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { CopyButton } from "@/components/CopyButton";
import { CoverGenerator } from "@/components/CoverGenerator";
import { WechatStudio } from "@/components/WechatStudio";
import { useScrollSync } from "@/hooks/use-scroll-sync";
import { getCoverFolderName } from "@/lib/cover-client";
import {
  downloadIllustrations,
  downloadAiIllustrations,
  downloadSavedCover,
  type IllustrationRef,
} from "@/lib/draft-tasks";
import {
  PLATFORM_LABELS,
  DRAFT_STATUS_LABELS,
  type Draft,
  type DraftMeta,
  type Topic,
  type DraftStatus,
} from "@/lib/types";
import { formatForCopy } from "@/lib/format";
import {
  Save,
  ArrowLeft,
  Trash2,
  Sparkles,
  Undo2,
  CheckCircle2,
  ImagePlus,
  Loader2,
  Download,
  Wand2,
} from "lucide-react";
import { AI_ILLUSTRATE_STYLES, resolveAiIllustrateStyle } from "@/lib/illustrate-styles";

// 未知平台兜底：字典查不到就显示原始平台字符串，避免留空白
function platformLabel(p: string): string {
  return (PLATFORM_LABELS as Record<string, string>)[p] ?? p;
}

// ISO 时间 → 「YYYY-MM-DDTHH:mm」本地时区格式（互动数据「上次记录」展示用）
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 互动数据字段与中文标签（读写 meta.stats）
const STAT_FIELDS = [
  ["views", "浏览"],
  ["likes", "点赞"],
  ["comments", "评论"],
  ["reposts", "转发"],
] as const;
type StatKey = (typeof STAT_FIELDS)[number][0];
type StatsForm = Record<StatKey, string>;

function statsFromMeta(meta: DraftMeta | null): StatsForm {
  const s = meta?.stats;
  const str = (v: number | undefined) => (typeof v === "number" ? String(v) : "");
  return {
    views: str(s?.views),
    likes: str(s?.likes),
    comments: str(s?.comments),
    reposts: str(s?.reposts),
  };
}

// 编辑器脏检查快照：与初始值比较，判断有无未保存修改
interface EditorSnapshot {
  title: string;
  content: string;
  status: DraftStatus;
  publishedUrl: string;
  stats: StatsForm;
}
const snap = (s: EditorSnapshot) => JSON.stringify(s);

export function DraftEditor({
  draft: initial,
  topic,
  presetAiStyle,
}: {
  draft: Draft;
  topic: Topic | null;
  /** 设置页预设的 AI 配图风格，作为本页下拉框的初始选中项（逐篇仍可临时改） */
  presetAiStyle?: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title ?? "");
  const [content, setContent] = useState(initial.content ?? "");
  const [status, setStatus] = useState<DraftStatus>(initial.status);
  const [publishedUrl, setPublishedUrl] = useState(initial.published_url ?? "");
  const [stats, setStats] = useState<StatsForm>(() => statsFromMeta(initial.meta));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 复制后的「标记已发布」快捷操作
  const [showQuickPublish, setShowQuickPublish] = useState(false);
  const [quickUrl, setQuickUrl] = useState("");
  const [marking, setMarking] = useState(false);

  // AI 修改
  const [feedback, setFeedback] = useState("");
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState("");
  // 保留 AI 动稿前的旧稿（修改/配图/标题共用），支持一键撤销
  const [prevVersion, setPrevVersion] = useState<{ title: string; content: string } | null>(null);

  // AI 标题（deepseek flash）
  const [titling, setTitling] = useState(false);
  const [titleError, setTitleError] = useState("");

  // 手动下载全部图片（封面 + 配图）：自动下载有两个绕不开的浏览器限制——
  // ① 文件夹权限过期后 requestPermission 只能在用户手势里弹窗，自动链路弹不了；
  // ② 非手势下循环触发多个浏览器下载会被 Chrome 拦截（只放行第一个）。
  // 这个按钮在用户手势里跑，两个限制都不存在，是自动下载失灵时的兜底。
  const [downloadingImgs, setDownloadingImgs] = useState(false);
  const [downloadImgMsg, setDownloadImgMsg] = useState("");

  // AI 配图（仅公众号）
  const [illustrating, setIllustrating] = useState(false);
  const [illustrateMsg, setIllustrateMsg] = useState("");
  const [illustrateError, setIllustrateError] = useState(false);
  // 配图清单的「活」副本：重新配图后服务端已落库新清单，这里跟着更新，
  // 「下载图片」按钮永远用它——此前直接读 initial.meta 快照，重配后下载到的是旧图（张冠李戴）
  const [illustrations, setIllustrations] = useState<IllustrationRef[]>(
    () => ((initial.meta as DraftMeta | null)?.illustrations ?? []) as IllustrationRef[],
  );

  // AI 生成配图（认知锚点链路，仅公众号）：不搜图，拆认知锚点后用 gpt-image-2 现生现画。
  // 与上面的图库配图并存，两个按钮互不影响；一张图真金白银，服务端硬上限 4 张。
  const [aiIllustrateStyle, setAiIllustrateStyle] = useState<string>(resolveAiIllustrateStyle(presetAiStyle).key);
  const [illustratingAi, setIllustratingAi] = useState(false);
  const [illustrateAiMsg, setIllustrateAiMsg] = useState("");
  const [illustrateAiError, setIllustrateAiError] = useState(false);

  // 公众号稿：编辑区与排版预览滚动同步
  const isWechat = initial.platform === "wechat";
  const scrollSync = useScrollSync();

  // 脏检查基线：保存成功后重置
  const [baseline, setBaseline] = useState(() =>
    snap({
      title: initial.title ?? "",
      content: initial.content ?? "",
      status: initial.status,
      publishedUrl: initial.published_url ?? "",
      stats: statsFromMeta(initial.meta),
    }),
  );
  const dirty = snap({ title, content, status, publishedUrl, stats }) !== baseline;

  // 预览用的 draft（随编辑实时变化）
  const preview: Draft = { ...initial, title, content };

  // 组装 meta：在原 meta 基础上写入 stats（保留 tags/question/cover 等其他字段）
  function buildMetaWithStats(): DraftMeta | undefined {
    const prev = (initial.meta ?? {}) as DraftMeta;
    const nums: Record<string, number> = {};
    for (const [key] of STAT_FIELDS) {
      const v = stats[key].trim();
      if (v !== "" && Number.isFinite(Number(v))) nums[key] = Number(v);
    }
    if (Object.keys(nums).length === 0 && !prev.stats) return undefined;
    const statsChanged = JSON.stringify(stats) !== JSON.stringify(statsFromMeta(initial.meta));
    return {
      ...prev,
      stats: {
        ...nums,
        recordedAt: statsChanged ? new Date().toISOString() : prev.stats?.recordedAt,
      },
    };
  }

  // 保存：所有失败路径都不丢用户输入，按钮显示「保存失败，重试」
  async function save(): Promise<boolean> {
    if (saving) return false;
    setSaving(true);
    setSaveError(false);
    try {
      const body: Record<string, unknown> = { title, content, status };
      if (status === "published") {
        body.published_url = publishedUrl;
        const meta = buildMetaWithStats();
        if (meta) body.meta = meta;
      }
      const res = await fetch(`/api/drafts/${initial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setBaseline(snap({ title, content, status, publishedUrl, stats }));
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      router.refresh();
      return true;
    } catch {
      setSaveError(true);
      return false;
    } finally {
      setSaving(false);
    }
  }

  // Cmd/Ctrl+S 触发保存（用 ref 拿最新的 save，避免闭包过期；在 effect 里同步而非渲染期写 ref）
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 有未保存修改时，拦截关闭/刷新页面
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // 删除稿件：确认后删除并跳回所属选题页或稿件列表
  async function removeDraft() {
    if (deleting) return;
    if (!confirm("确定删除这篇稿件？删除后不可恢复。")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/drafts/${initial.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // 删除后跳转前先把基线对齐，避免 beforeunload 误拦
      setBaseline(snap({ title, content, status, publishedUrl, stats }));
      router.push(topic ? `/topics/${topic.id}` : "/drafts");
      router.refresh();
    } catch {
      setDeleting(false);
      alert("删除失败，请重试");
    }
  }

  // 复制成功后一键标记已发布：status + 发布链接 + 当前编辑内容一次保存
  async function markPublished() {
    if (marking) return;
    setMarking(true);
    const url = quickUrl.trim();
    try {
      const body: Record<string, unknown> = {
        title,
        content,
        status: "published",
        published_url: url,
      };
      const meta = buildMetaWithStats();
      if (meta) body.meta = meta;
      const res = await fetch(`/api/drafts/${initial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus("published");
      setPublishedUrl(url);
      setBaseline(snap({ title, content, status: "published", publishedUrl: url, stats }));
      setShowQuickPublish(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      router.refresh();
    } catch {
      alert("标记发布失败，请重试");
    } finally {
      setMarking(false);
    }
  }

  // AI 定向修改：结果填回编辑区（旧稿留内存可撤销），不自动保存
  async function refine() {
    const fb = feedback.trim();
    if (!fb || refining) return;
    setRefining(true);
    setRefineError("");
    try {
      const res = await fetch(`/api/drafts/${initial.id}/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: fb, title, content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setPrevVersion({ title, content });
      if (typeof data.title === "string" && data.title) setTitle(data.title);
      if (typeof data.content === "string" && data.content) setContent(data.content);
      setFeedback("");
    } catch (e) {
      setRefineError(e instanceof Error ? e.message : "AI 修改失败，请重试");
    } finally {
      setRefining(false);
    }
  }

  function undoRefine() {
    if (!prevVersion) return;
    setTitle(prevVersion.title);
    setContent(prevVersion.content);
    setPrevVersion(null);
  }

  // AI 重写标题：轻量任务走 deepseek-v4-flash，结果只填回标题框，可撤销、不自动保存
  async function regenTitle() {
    if (titling) return;
    setTitling(true);
    setTitleError("");
    try {
      const res = await fetch(`/api/drafts/${initial.id}/title`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      if (typeof data.title === "string" && data.title) {
        setPrevVersion({ title, content });
        setTitle(data.title);
      }
    } catch (e) {
      setTitleError(e instanceof Error ? e.message : "AI 标题失败，请重试");
    } finally {
      setTitling(false);
    }
  }

  // 手动下载全部图片：封面（服务端已生成的）+ 配图原图，按笔记目录结构写入绑定文件夹。
  // 下载/落盘逻辑走 lib/draft-tasks.ts 的共享实现，本函数只做汇总提示。
  async function downloadAllImages() {
    if (downloadingImgs) return;
    setDownloadingImgs(true);
    setDownloadImgMsg("下载中…");
    const noteTitle = topic?.title || title || "未命名";
    const folderName = await getCoverFolderName().catch(() => null);
    let toFolder = 0;
    let toDownload = 0;
    let failed = 0;
    let coverGot = false;

    // 封面：读服务端已生成并落库的那张（没有就跳过，去下方封面卡片生成）
    try {
      const r = await downloadSavedCover(initial.id, noteTitle);
      if (r) {
        coverGot = true;
        if (r.outcome.dest === "folder") toFolder++;
        else toDownload++;
      }
    } catch {
      failed++;
    }

    // 配图原图：用「活」清单（重新配图后已同步），经代理逐张拉取
    const s = await downloadIllustrations(illustrations, noteTitle);
    toFolder += s.toFolder;
    toDownload += s.toDownload;
    failed += s.failed;

    const parts: string[] = [];
    if (toFolder) parts.push(`${toFolder} 张已存入「${folderName ?? "绑定文件夹"}」`);
    if (toDownload) parts.push(`${toDownload} 张走了浏览器下载${s.hint ? `（${s.hint}）` : ""}`);
    if (failed) parts.push(`${failed} 张失败`);
    if (!coverGot) parts.push("封面还没生成（可在下方封面卡片生成）");
    if (!illustrations.length) parts.push("稿件没有配图清单");
    setDownloadImgMsg(parts.length ? parts.join("，") : "没有可下载的图片");
    setDownloadingImgs(false);
  }

  // AI 配图：LLM 选插图点 + 图库搜图插入正文（可撤销），图片经代理下载到封面绑定文件夹。
  // 服务端已把新正文与新配图清单落库（此前不落库，meta.illustrations 停留在旧清单，
  // 「下载图片」会下到跟正文对不上的旧图），这里同步更新本地清单与脏检查基线。
  async function illustrate() {
    if (illustrating) return;
    setIllustrating(true);
    setIllustrateError(false);
    setIllustrateMsg("");
    try {
      const res = await fetch(`/api/drafts/${initial.id}/illustrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const images = (data.images ?? []) as IllustrationRef[];
      const newContent = String(data.content ?? content);
      setPrevVersion({ title, content });
      setContent(newContent);
      setIllustrations(images);
      // 服务端已把标题+新正文+新清单一并落库（路由带 title 落库就是为了这里能安全重置基线，
      // 否则未保存的标题改动会被「已保存」假象掩盖而静默丢失）。
      // 基线只更新真正落库的 title/content，status、发布链接、排期、互动数据沿用旧基线——
      // 它们没被这次请求保存，若用户改过必须继续显示「未保存」
      setBaseline((prev) => {
        const p = JSON.parse(prev) as EditorSnapshot;
        return snap({ ...p, title, content: newContent });
      });
      setIllustrateMsg(`已插入 ${images.length} 张配图（已保存），正在下载图片…`);
      const s = await downloadIllustrations(images, topic?.title || title || "未命名");
      const parts = [`已插入 ${images.length} 张配图（已保存）`];
      if (s.toFolder) parts.push(`${s.toFolder} 张原图已备份到绑定文件夹`);
      if (s.toDownload) parts.push(`${s.toDownload} 张走了浏览器下载（${s.hint || "可能被拦截"}，可点「下载图片」手动补）`);
      if (s.failed) parts.push(`${s.failed} 张备份失败（点「下载图片」重试）`);
      setIllustrateMsg(parts.join("，") + "。复制到公众号时图片随富文本带过去，个别转存失败的用本地原图替换。");
      router.refresh();
    } catch (e) {
      setIllustrateError(true);
      setIllustrateMsg(e instanceof Error ? e.message : "AI 配图失败，请重试");
    } finally {
      setIllustrating(false);
    }
  }

  // AI 生成配图：拆认知锚点 + gpt-image-2 现生现画（不搜图），与图库配图链路并存。
  // 服务端已把插好图（data URI）的新正文与新清单落库，这里同步本地状态与脏检查基线，
  // 再把每张图落盘到本地绑定文件夹（图已传 Vercel Blob，按返回的直链经代理拉回）。
  async function illustrateAi() {
    if (illustratingAi) return;
    setIllustratingAi(true);
    setIllustrateAiError(false);
    setIllustrateAiMsg("拆认知锚点 + 生图中，通常要 1-3 分钟…");
    try {
      const res = await fetch(`/api/drafts/${initial.id}/illustrate-ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content, styleKey: aiIllustrateStyle }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const images = (data.images ?? []) as { filename: string; caption: string; url: string }[];
      const newContent = String(data.content ?? content);
      setPrevVersion({ title, content });
      setContent(newContent);
      setBaseline((prev) => {
        const p = JSON.parse(prev) as EditorSnapshot;
        return snap({ ...p, title, content: newContent });
      });
      setIllustrateAiMsg(`已生成并插入 ${images.length} 张 AI 配图（已保存），正在存本地…`);
      const s = await downloadAiIllustrations(images, topic?.title || title || "未命名");
      const parts = [`已生成并插入 ${images.length} 张 AI 配图（已保存）`];
      if (data.failedCount) parts.push(`${data.failedCount} 个锚点生图失败已跳过`);
      if (s.toFolder) parts.push(`${s.toFolder} 张已存入绑定文件夹`);
      if (s.toDownload) parts.push(`${s.toDownload} 张走了浏览器下载（${s.hint || "可能被拦截"}）`);
      if (s.failed) parts.push(`${s.failed} 张本地保存失败`);
      setIllustrateAiMsg(parts.join("，") + "。图片以 data URI 直接嵌在正文里，预览和复制均可见。");
      router.refresh();
    } catch (e) {
      setIllustrateAiError(true);
      setIllustrateAiMsg(e instanceof Error ? e.message : "AI 生成配图失败，请重试");
    } finally {
      setIllustratingAi(false);
    }
  }

  const recordedAt = (initial.meta as DraftMeta | null)?.stats?.recordedAt;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {topic && (
            <Link
              href={`/topics/${topic.id}`}
              className="text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                // 有未保存修改时，返回前确认
                if (dirty && !confirm("有未保存的修改，确定离开？")) e.preventDefault();
              }}
            >
              <ArrowLeft className="size-5" />
            </Link>
          )}
          <div>
            <div className="flex items-center gap-2">
              <Badge>{platformLabel(initial.platform)}</Badge>
              <Badge variant="muted">{initial.generator === "api" ? "DeepSeek" : "Claude Code"}</Badge>
              {dirty && <Badge variant="outline">未保存</Badge>}
            </div>
            {topic && <p className="mt-1 text-sm text-muted-foreground">选题：{topic.title || topic.angle}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={status} onChange={(e) => setStatus(e.target.value as DraftStatus)} className="w-28">
            {Object.entries(DRAFT_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </Select>
          <Button
            onClick={save}
            disabled={saving}
            variant={saveError ? "destructive" : saved ? "secondary" : "default"}
          >
            <Save /> {saving ? "保存中…" : saveError ? "保存失败，重试" : saved ? "已保存" : "保存"}
          </Button>
          <Button variant="ghost" size="icon" title="删除稿件" onClick={removeDraft} disabled={deleting}>
            <Trash2 className="text-destructive" />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 编辑区 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">编辑</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium">标题</label>
              <div className="flex gap-2">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                <Button
                  variant="outline"
                  className="shrink-0"
                  title="AI 重新生成标题（轻量模型）"
                  onClick={regenTitle}
                  disabled={titling || !content.trim()}
                >
                  {titling ? <Loader2 className="animate-spin" /> : <Sparkles />} AI 标题
                </Button>
              </div>
              {titleError && <p className="mt-1 text-xs text-destructive">{titleError}</p>}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">正文</label>
              {/* 公众号稿：编辑区固定高度，与右侧预览做比例滚动同步 */}
              <Textarea
                ref={isWechat ? (scrollSync.left.ref as (el: HTMLTextAreaElement | null) => void) : undefined}
                onScroll={isWechat ? scrollSync.left.onScroll : undefined}
                rows={18}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className={"font-mono text-sm" + (isWechat ? " h-[70vh] resize-none" : "")}
              />
            </div>

            {/* AI 修改：按反馈定向改稿，未点名部分保留；结果可一键撤销，不自动保存 */}
            <div className="space-y-2 rounded-lg border p-3">
              <label className="block text-sm font-medium">AI 修改</label>
              <Textarea
                rows={2}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="告诉 AI 要改哪里，例如：开头太平了，换个抓人的开头；第二段例子换掉"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={refine} disabled={refining || !feedback.trim()}>
                  <Sparkles /> {refining ? "修改中…" : "AI 修改"}
                </Button>
                {prevVersion && (
                  <Button size="sm" variant="outline" onClick={undoRefine}>
                    <Undo2 /> 撤销 AI 修改
                  </Button>
                )}
                {refineError && <span className="text-xs text-destructive">{refineError}</span>}
              </div>
              <p className="text-xs text-muted-foreground">修改结果只填回编辑区，确认满意后再点保存。</p>
            </div>

            {/* AI 配图：仅公众号稿。图库搜图插入正文 + 原图下载到本地绑定文件夹 */}
            {isWechat && (
              <div className="space-y-2 rounded-lg border p-3">
                <label className="block text-sm font-medium">AI 配图（重新配图）</label>
                <p className="text-xs text-muted-foreground">
                  生成正文时已自动配图；改稿后或对配图不满意时点这里重配：AI 重挑 2-4 处插图点，
                  从 Pexels/Pixabay 搜图插入正文，原图备份到封面绑定的文件夹。
                  复制到公众号时图片随富文本带过去、编辑器自动转存；个别失败的用本地同名原图替换。
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={illustrate} disabled={illustrating || !content.trim()}>
                    {illustrating ? <Loader2 className="animate-spin" /> : <ImagePlus />}
                    {illustrating ? "配图中…" : "AI 配图"}
                  </Button>
                  {/* 手动下载兜底：自动下载受浏览器限制（权限弹窗要手势、多文件下载会被拦），
                      点这里在用户手势里重新下载封面 + 全部配图，按笔记目录结构落盘 */}
                  <Button size="sm" variant="outline" onClick={downloadAllImages} disabled={downloadingImgs}>
                    {downloadingImgs ? <Loader2 className="animate-spin" /> : <Download />}
                    {downloadingImgs ? "下载中…" : "下载图片（封面+配图）"}
                  </Button>
                  {prevVersion && (
                    <Button size="sm" variant="outline" onClick={undoRefine}>
                      <Undo2 /> 撤销 AI 改动
                    </Button>
                  )}
                </div>
                {illustrateMsg && (
                  <p className={"text-xs " + (illustrateError ? "text-destructive" : "text-muted-foreground")}>
                    {illustrateMsg}
                  </p>
                )}
                {downloadImgMsg && <p className="text-xs text-muted-foreground">{downloadImgMsg}</p>}
              </div>
            )}

            {/* AI 生成配图：不搜图，拆认知锚点后用 gpt-image-2 现生现画，与上面图库配图并存 */}
            {isWechat && (
              <div className="space-y-2 rounded-lg border p-3">
                <label className="block text-sm font-medium">AI 生成配图（知识图解，现生现画）</label>
                <p className="text-xs text-muted-foreground">
                  不搜图库：先把正文拆成核心判断/断点/对比/常见坑这类认知锚点（最多 4 个），
                  再按所选风格现生现画配图，信息价值优先于视觉呼吸感。一张图真金白银，请按需点击。
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={aiIllustrateStyle}
                    onChange={(e) => setAiIllustrateStyle(e.target.value)}
                    className="w-56"
                  >
                    {AI_ILLUSTRATE_STYLES.map((s) => (
                      <option key={s.key} value={s.key}>{s.label}</option>
                    ))}
                  </Select>
                  <Button size="sm" onClick={illustrateAi} disabled={illustratingAi || !content.trim()}>
                    {illustratingAi ? <Loader2 className="animate-spin" /> : <Wand2 />}
                    {illustratingAi ? "生成中…" : "AI 生成配图"}
                  </Button>
                  {prevVersion && (
                    <Button size="sm" variant="outline" onClick={undoRefine}>
                      <Undo2 /> 撤销 AI 改动
                    </Button>
                  )}
                </div>
                {illustrateAiMsg && (
                  <p className={"text-xs " + (illustrateAiError ? "text-destructive" : "text-muted-foreground")}>
                    {illustrateAiMsg}
                  </p>
                )}
              </div>
            )}

            {status === "published" && (
              <>
                <div>
                  <label className="mb-1 block text-sm font-medium">发布链接</label>
                  <Input
                    value={publishedUrl}
                    onChange={(e) => setPublishedUrl(e.target.value)}
                    placeholder="https://..."
                  />
                </div>
                {/* 互动数据回填：读写 meta.stats，随保存一起提交 */}
                <div>
                  <label className="mb-1 block text-sm font-medium">互动数据回填</label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {STAT_FIELDS.map(([key, label]) => (
                      <div key={key}>
                        <label className="mb-0.5 block text-xs text-muted-foreground">{label}</label>
                        <Input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={stats[key]}
                          onChange={(e) => setStats((s) => ({ ...s, [key]: e.target.value }))}
                          placeholder="0"
                        />
                      </div>
                    ))}
                  </div>
                  {recordedAt && (
                    <p className="mt-1 text-xs text-muted-foreground" suppressHydrationWarning>
                      上次记录：{toLocalInput(recordedAt).replace("T", " ")}
                    </p>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* 预览区：公众号用 WeMark 排版预览（富文本复制），其余平台用纯文本预览 */}
        {initial.platform === "wechat" ? (
          // onContentChange/onTitleChange 打开右侧「可写模式」：预览里改的内容回到同一份
          // title/content 状态，左侧编辑区、脏标记、保存、AI 链路全都自动跟上
          <WechatStudio
            draftId={initial.id}
            title={title}
            content={content}
            sync={scrollSync.right}
            onContentChange={setContent}
            onTitleChange={setTitle}
          />
        ) : (
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base">{platformLabel(initial.platform)} 预览</CardTitle>
              <CopyButton
                text={formatForCopy(preview)}
                label="复制全部"
                onCopied={() => {
                  // 复制成功且未发布 → 原地出现「标记已发布」快捷操作
                  if (status !== "published") setShowQuickPublish(true);
                }}
              />
            </CardHeader>
            <CardContent>
              {showQuickPublish && status !== "published" && (
                <div className="mb-3 space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
                  <p className="text-sm font-medium">已复制。发出去了？一键标记为已发布：</p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={quickUrl}
                      onChange={(e) => setQuickUrl(e.target.value)}
                      placeholder="发布链接（可选）https://..."
                      className="h-9"
                    />
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" onClick={markPublished} disabled={marking}>
                        <CheckCircle2 /> {marking ? "标记中…" : "标记已发布"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setShowQuickPublish(false)}>
                        先不用
                      </Button>
                    </div>
                  </div>
                </div>
              )}
              <PlatformPreview draft={preview} />
            </CardContent>
          </Card>
        )}
      </div>

      {/* 公众号稿件：AI 封面图生成 */}
      {initial.platform === "wechat" && (
        <CoverGenerator
          draft={initial}
          title={title}
          content={content}
          noteDir={topic?.title || title}
        />
      )}
    </div>
  );
}

// 非公众号排版路径的纯文本预览兜底（历史脏数据平台也能看正文）
function PlatformPreview({ draft }: { draft: Draft }) {
  return <p className="whitespace-pre-wrap">{draft.content}</p>;
}
