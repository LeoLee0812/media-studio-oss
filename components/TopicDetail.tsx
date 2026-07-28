"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import {
  PLATFORM_LABELS,
  TOPIC_STATUS_LABELS,
  SOURCE_LABELS,
  DRAFT_STATUS_LABELS,
  type Topic,
  type Material,
  type Draft,
  type Platform,
  type TopicStatus,
} from "@/lib/types";
import { STYLE_DEFS, getStyleDef, type WritingStyle } from "@/lib/styles";
import {
  sanitizeFsName,
  chooseCoverFolder,
  getCoverFolderName,
  folderPickerSupported,
} from "@/lib/cover-client";
import { runPostDraftTasks } from "@/lib/draft-tasks";
import {
  ExternalLink,
  Sparkles,
  FileText,
  Loader2,
  Check,
  X,
  RefreshCw,
  Trash2,
  FolderOpen,
} from "lucide-react";

// 生成入口当前只保留公众号（其余平台的规范仍在提示词页备用）
const PLATFORMS: Platform[] = ["wechat"];

// 单个平台的生成状态
type PlatformState = "running" | "done" | "error";

export function TopicDetail({
  topic,
  materials,
  drafts,
  llmEnabled,
  defaultStyle,
}: {
  topic: Topic;
  materials: Material[];
  drafts: Draft[];
  llmEnabled: boolean;
  defaultStyle: WritingStyle;
}) {
  const router = useRouter();

  const [selected, setSelected] = useState<Platform[]>(["wechat"]);
  // 写作风格：初始取设置页的默认风格，可逐篇改
  const [style, setStyle] = useState<WritingStyle>(defaultStyle);
  const [extra, setExtra] = useState("");
  // 真实经历独立于附加指令：它是「防编造第一人称」的判定信号，附加指令只是自由指令
  const [experience, setExperience] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState("");
  // 服务端收尾（配图/封面提示词）的失败说明——以前被吞在服务端日志里，用户只看到「图凭空没了」
  const [warnMsg, setWarnMsg] = useState("");
  const [platformStates, setPlatformStates] = useState<Partial<Record<Platform, PlatformState>>>({});

  // 封面同步生成状态
  const [coverMsg, setCoverMsg] = useState("");
  const [coverBusy, setCoverBusy] = useState(false);
  const [folderName, setFolderName] = useState<string | null>(null);
  // 配图下载状态（配图已在服务端随正文插好，这里只负责把原图落到本地）
  const [illustMsg, setIllustMsg] = useState("");
  // 小红书高亮预热状态
  const [xhsMsg, setXhsMsg] = useState("");

  // 本篇笔记的图片子文件夹名：绑定文件夹/<笔记名>/封面 + <笔记名>/子图/配图N
  const noteDir = sanitizeFsName(topic.title || "未命名");

  const [statusMsg, setStatusMsg] = useState("");
  const [deleting, setDeleting] = useState(false);

  // 卸载保护：收尾任务最长要跑 1-2 分钟，期间用户点进稿件页组件就卸载了，
  // 迟到的 setState 全部丢弃（React 18 下只是 no-op，但状态串台会误导用户）
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // 包一层「组件还活着才 set」的守卫，收尾任务的所有状态更新都走它
  const guard =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      if (alive.current) set(v);
    };

  // 已绑定的封面保存文件夹名（仅展示）
  useEffect(() => {
    getCoverFolderName().then(guard(setFolderName)).catch(() => {});
  }, []);

  async function bindFolder() {
    try {
      const name = await chooseCoverFolder();
      setFolderName(name);
      setCoverMsg(`封面将自动存入「${name}」文件夹`);
    } catch {
      // 用户取消选择时静默
    }
  }

  async function setStatus(status: TopicStatus) {
    setStatusMsg("");
    try {
      const res = await fetch(`/api/topics/${topic.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setStatusMsg("状态更新失败，请重试");
    }
  }

  // 删除选题：稿件随外键级联一并删除，成功后跳回选题列表
  async function removeTopic() {
    if (!window.confirm("确定删除该选题？其下所有稿件会一并删除，不可恢复。")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/topics/${topic.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "删除失败");
      }
      router.push("/topics");
      router.refresh();
      return;
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : "删除失败，请重试");
      setDeleting(false);
    }
  }

  function togglePlatform(p: Platform) {
    if (generating) return;
    setSelected((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));
  }

  // 生成单个平台：完成即 refresh 让稿件实时长出来；返回新稿件（失败返回 null）
  async function generateOne(p: Platform): Promise<Draft | null> {
    setPlatformStates((s) => ({ ...s, [p]: "running" }));
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicId: topic.id,
          extra,
          experience,
          style,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data.drafts?.length ?? 0) > 0) {
        setPlatformStates((s) => ({ ...s, [p]: "done" }));
        if (Array.isArray(data.warnings) && data.warnings.length) {
          setWarnMsg(`收尾提醒：${data.warnings.join("；")}`);
        }
        router.refresh();
        return data.drafts[0] ?? null;
      }
      setPlatformStates((s) => ({ ...s, [p]: "error" }));
      const detail = data?.errors?.[p] || data?.error;
      if (detail) setGenMsg(`${PLATFORM_LABELS[p]}失败：${String(detail).slice(0, 120)}`);
      return null;
    } catch {
      setPlatformStates((s) => ({ ...s, [p]: "error" }));
      return null;
    }
  }

  // 正文出来后的三个收尾任务**并行跑**（完成时间差异很大：配图下载几秒、封面生图 1-2 分钟、
  // 高亮 30-40 秒），各自维护自己的状态行，谁先完成谁先亮。
  // 编排的唯一实现在 lib/draft-tasks.ts（与洗稿页共用），这里只接状态回调。
  async function postDraftTasks(draft: Draft) {
    await runPostDraftTasks(draft, topic.title || "未命名", {
      onIllustMsg: guard(setIllustMsg),
      onCoverMsg: guard(setCoverMsg),
      onCoverBusy: guard(setCoverBusy),
      onXhsMsg: guard(setXhsMsg),
    });
    if (alive.current) router.refresh();
  }

  // 单步直出（母稿两步制已砍）：素材+调研进来，公众号成稿出去。
  // 公众号稿：服务端已同步插好配图；成功后「配图原图下载 ∥ 封面生图 ∥ 小红书高亮预热」三路并行
  async function generate() {
    if (selected.length === 0 || generating) return;
    setGenerating(true);
    setPlatformStates({});
    setCoverMsg("");
    setIllustMsg("");
    setXhsMsg("");
    setWarnMsg("");
    setGenMsg("单步成稿中（约一分钟）…");
    let ok = 0;
    const failed: Platform[] = [];
    let wechatDraft: Draft | null = null;
    for (let i = 0; i < selected.length; i++) {
      const p = selected[i];
      const draft = await generateOne(p);
      if (draft) {
        ok++;
        if (p === "wechat") wechatDraft = draft;
      } else {
        failed.push(p);
      }
    }
    setGenerating(false);
    setGenMsg(
      `完成：成功 ${ok}/${selected.length} 篇` +
        (failed.length
          ? `，失败：${failed.map((p) => PLATFORM_LABELS[p]).join("、")}（可单独重试）`
          : ""),
    );
    if (wechatDraft) await postDraftTasks(wechatDraft);
  }

  // 单独重试某个失败平台
  async function retryOne(p: Platform) {
    if (generating) return;
    setGenerating(true);
    setGenMsg(`重试${PLATFORM_LABELS[p]}中…`);
    const draft = await generateOne(p);
    setGenMsg(draft ? `${PLATFORM_LABELS[p]}已生成` : `${PLATFORM_LABELS[p]}仍失败，可稍后再试`);
    setGenerating(false);
    if (draft && p === "wechat") await postDraftTasks(draft);
  }

  const failedPlatforms = PLATFORMS.filter((p) => platformStates[p] === "error");
  const styleDef = getStyleDef(style);

  return (
    <div className="space-y-5">
      {/* 头部 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {topic.pillar && <Badge variant="outline">{topic.pillar}</Badge>}
            <Badge variant="secondary">{TOPIC_STATUS_LABELS[topic.status]}</Badge>
          </div>
          <h1 className="text-2xl font-bold">{topic.title || "未命名选题"}</h1>
          {topic.angle && <p className="max-w-2xl text-muted-foreground">切入角度：{topic.angle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={topic.status}
            onChange={(e) => setStatus(e.target.value as TopicStatus)}
            className="w-32"
          >
            {Object.entries(TOPIC_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </Select>
          <Button variant="destructive" size="sm" onClick={removeTopic} disabled={deleting}>
            <Trash2 /> {deleting ? "删除中…" : "删除选题"}
          </Button>
        </div>
      </div>
      {statusMsg && <p className="text-sm text-destructive">{statusMsg}</p>}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* 素材 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">素材（{materials.length}）</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {materials.map((m) => (
              <div key={m.id} className="rounded-lg border p-3">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary">{SOURCE_LABELS[m.source]}</Badge>
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
                </div>
                <div className="font-medium">{m.title}</div>
                {m.summary && <p className="mt-1 text-sm text-muted-foreground">{m.summary}</p>}
                {m.content && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground">展开全文</summary>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{m.content}</p>
                  </details>
                )}
              </div>
            ))}
            {materials.length === 0 && (
              <p className="text-sm text-muted-foreground">未挂载素材。</p>
            )}
          </CardContent>
        </Card>

        {/* 生成：正文 + 封面一次出 */}
        <Card className="self-start">
          <CardHeader>
            <CardTitle className="text-base">生成稿件（正文 → 配图 ∥ 封面 ∥ 小红书高亮）</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!llmEnabled ? (
              <p className="text-sm text-muted-foreground">
                未配置文案引擎 API Key，生成入口不可用。请到设置页填写引擎 Key。
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {PLATFORMS.map((p) => {
                    const st = platformStates[p];
                    return (
                      <button
                        key={p}
                        onClick={() => togglePlatform(p)}
                        disabled={generating}
                        className={
                          "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors disabled:opacity-70 " +
                          (selected.includes(p)
                            ? "border-primary bg-primary text-primary-foreground"
                            : "hover:bg-accent")
                        }
                      >
                        {PLATFORM_LABELS[p]}
                        {st === "running" && <Loader2 className="size-3.5 animate-spin" />}
                        {st === "done" && <Check className="size-3.5" />}
                        {st === "error" && <X className="size-3.5" />}
                      </button>
                    );
                  })}
                </div>
                {/* 写作风格开关：决定注入哪套文风提示词（见 lib/styles.ts），改完立刻生效。 */}
                <div className="space-y-1.5 rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">写作风格</span>
                    {STYLE_DEFS.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setStyle(s.id)}
                        disabled={generating}
                        className={
                          "rounded-md border px-3 py-1 text-sm transition-colors disabled:opacity-70 " +
                          (style === s.id
                            ? "border-primary bg-primary text-primary-foreground"
                            : "hover:bg-accent")
                        }
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">{styleDef.hint}</p>
                </div>
                {/* 真实经历与附加指令分开：经历字段是「防编造第一人称」的判定信号，
                    留空 → 文章骨架锁定为不依赖亲身下场的原型；附加指令是自由指令，不影响该判定 */}
                <Textarea
                  rows={2}
                  value={experience}
                  onChange={(e) => setExperience(e.target.value)}
                  placeholder="真实经历（可选）：你的真实使用感受/踩坑写这里，会被织进稿子。留空则稿子零第一人称实测，不会编。"
                />
                <Textarea
                  rows={2}
                  value={extra}
                  onChange={(e) => setExtra(e.target.value)}
                  placeholder="附加指令（可选）：切入重点、想强调/回避的点、标题要求等。"
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={generate} disabled={generating || coverBusy || selected.length === 0}>
                    <Sparkles /> {generating ? "生成中…" : "生成正文 + 配图 + 封面 + 小红书"}
                  </Button>
                </div>
                {genMsg && <p className="text-sm text-muted-foreground">{genMsg}</p>}
                {warnMsg && <p className="text-sm text-destructive">{warnMsg}</p>}
                {illustMsg && <p className="text-sm text-muted-foreground">{illustMsg}</p>}
                {xhsMsg && <p className="text-sm text-muted-foreground">{xhsMsg}</p>}
                {(coverBusy || coverMsg) && (
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    {coverBusy && <Loader2 className="size-3.5 animate-spin" />}
                    {coverMsg}
                  </p>
                )}
                {failedPlatforms.length > 0 && !generating && (
                  <div className="flex flex-wrap items-center gap-2">
                    {failedPlatforms.map((p) => (
                      <Button key={p} size="sm" variant="outline" onClick={() => retryOne(p)}>
                        <RefreshCw /> 重试{PLATFORM_LABELS[p]}
                      </Button>
                    ))}
                  </div>
                )}
                {folderPickerSupported() && (
                  <p className="flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
                    <FolderOpen className="size-3.5" />
                    封面/配图保存位置：
                    {folderName
                      ? `「${folderName}/${noteDir}」（封面在根，配图在 子图/）`
                      : "浏览器默认下载目录"}
                    <button type="button" onClick={bindFolder} className="text-blue-500 hover:underline">
                      {folderName ? "更换文件夹" : "绑定本地文件夹（如 桌面/公众号-封面）"}
                    </button>
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 稿件变体 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">稿件变体（{drafts.length}）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {drafts.map((d) => (
            <Link
              key={d.id}
              href={`/drafts/${d.id}`}
              className="flex items-center justify-between rounded-md border p-2.5 text-sm hover:bg-accent"
            >
              <span className="flex items-center gap-2 truncate">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{d.title || d.content?.slice(0, 40) || "无标题"}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <Badge variant="outline">{PLATFORM_LABELS[d.platform]}</Badge>
                <Badge variant="muted">{DRAFT_STATUS_LABELS[d.status]}</Badge>
                {d.generator && <Badge variant="muted">{d.generator === "api" ? "API" : "CC"}</Badge>}
              </span>
            </Link>
          ))}
          {drafts.length === 0 && (
            <p className="text-sm text-muted-foreground">还没有稿件，点上方生成。</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
