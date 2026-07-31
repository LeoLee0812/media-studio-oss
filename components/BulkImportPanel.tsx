"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { MaterialCard } from "@/lib/queries";
import {
  BULK_BATCH_SIZE,
  MAX_IMPORT_FILES,
  isImportablePath,
  parseNote,
  type ParsedNote,
} from "@/lib/vault-import";
import { FolderOpen, FileText, Upload, X, Loader2 } from "lucide-react";

// 本地文件夹批量导入面板（「添加素材」弹窗的第二个标签页）。
//
// 三种投喂方式：选文件夹（webkitdirectory）/ 选多个文件 / 直接把文件夹拖进来。
// 文件全部由浏览器本地读取解析，只往自己这份部署的 /api/materials/bulk 发；
// 不经第三方，也不会碰公开演示站（演示站 READ_ONLY，写接口一律 403）。

interface Props {
  /** 板块联想候选（当前列表里已有的分类名） */
  pillarOptions: string[];
  /** 每批入库成功后回调，供外层乐观插入列表 */
  onImported: (materials: MaterialCard[]) => void;
  onClose: () => void;
}

/** 拖拽进来的目录条目（webkitGetAsEntry 的最小结构，浏览器类型定义缺失部分自己声明） */
interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (cb: (f: File) => void, err?: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (cb: (entries: FsEntry[]) => void, err?: (e: unknown) => void) => void };
}

/** 递归遍历一个拖进来的目录，收集所有文件（附带相对路径） */
async function walkEntry(entry: FsEntry, prefix: string, out: { path: string; file: File }[]) {
  if (out.length >= MAX_IMPORT_FILES) return;
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile && entry.file) {
    const file = await new Promise<File | null>((resolve) =>
      entry.file!((f) => resolve(f), () => resolve(null)),
    );
    if (file) out.push({ path, file });
    return;
  }
  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    // readEntries 每次最多返回 100 条，要一直读到返回空数组为止
    for (;;) {
      const batch = await new Promise<FsEntry[]>((resolve) =>
        reader.readEntries((entries) => resolve(entries), () => resolve([])),
      );
      if (batch.length === 0) break;
      for (const child of batch) await walkEntry(child, path, out);
    }
  }
}

/** 从一批 File（来自 input）里取相对路径：目录选择有 webkitRelativePath，单选文件退回文件名 */
function relPathOf(file: File): string {
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return rel && rel.length > 0 ? rel : file.name;
}

/** 一批相对路径的公共首层目录名 → 作为 vault 名；没有公共目录则用 "vault" */
function guessVaultName(paths: string[]): string {
  const firsts = new Set(paths.map((p) => (p.includes("/") ? p.split("/")[0] : "")));
  if (firsts.size === 1) {
    const only = [...firsts][0];
    if (only) return only;
  }
  return "vault";
}

/** 去掉 vault 前缀后的库内相对路径 */
function stripVault(path: string, vault: string): string {
  return path.startsWith(vault + "/") ? path.slice(vault.length + 1) : path;
}

export function BulkImportPanel({ pillarOptions, onImported, onClose }: Props) {
  const dirInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [vault, setVault] = useState("vault");
  const [notes, setNotes] = useState<ParsedNote[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [pillar, setPillar] = useState("");
  const [reading, setReading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 被过滤掉的非文本文件数量（图片/PDF/.obsidian 等），只做提示 */
  const [ignoredCount, setIgnoredCount] = useState(0);

  // webkitdirectory 不是标准 React 属性，挂 ref 后手动置上（Chrome/Edge/Safari 都支持）
  useEffect(() => {
    const el = dirInput.current;
    if (el) {
      el.setAttribute("webkitdirectory", "");
      el.setAttribute("directory", "");
    }
  }, []);

  const selected = useMemo(() => notes.filter((n) => !excluded.has(n.path)), [notes, excluded]);

  /** 把「相对路径 + File」列表读成解析后的笔记（过滤 + 去重 + 排序） */
  async function ingestFiles(entries: { path: string; file: File }[]) {
    setError(null);
    setResult(null);
    setReading(true);
    try {
      const all = entries.slice(0, MAX_IMPORT_FILES);
      const vaultName = guessVaultName(all.map((e) => e.path));
      const keep = all.filter((e) => isImportablePath(stripVault(e.path, vaultName)));
      setIgnoredCount(all.length - keep.length);

      const parsed: ParsedNote[] = [];
      for (const e of keep) {
        const rel = stripVault(e.path, vaultName);
        const raw = await e.file.text().catch(() => "");
        if (!raw.trim()) continue; // 空文件跳过
        parsed.push(parseNote(rel, raw));
      }
      parsed.sort((a, b) => a.path.localeCompare(b.path));
      setVault(vaultName);
      setNotes(parsed);
      setExcluded(new Set());
      if (parsed.length === 0) {
        setError(
          all.length > 0
            ? "没找到可导入的笔记（只收 .md / .markdown / .mdx / .txt，且跳过 .obsidian 等隐藏目录）"
            : "没读到任何文件",
        );
      }
    } finally {
      setReading(false);
    }
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const items = Array.from(e.dataTransfer.items);
    const collected: { path: string; file: File }[] = [];
    const entries = items
      .map((it) => (it.webkitGetAsEntry?.() as unknown as FsEntry | null) ?? null)
      .filter((x): x is FsEntry => !!x);
    if (entries.length > 0) {
      setReading(true);
      for (const entry of entries) await walkEntry(entry, "", collected);
      setReading(false);
      await ingestFiles(collected);
      return;
    }
    // 兜底：浏览器不支持 webkitGetAsEntry 时只能拿到平铺的文件
    const files = Array.from(e.dataTransfer.files).map((f) => ({ path: f.name, file: f }));
    await ingestFiles(files);
  }

  async function submit() {
    if (selected.length === 0) return;
    setError(null);
    setResult(null);
    setProgress({ done: 0, total: selected.length });
    let created = 0;
    let skipped = 0;
    let failed = 0;
    try {
      for (let i = 0; i < selected.length; i += BULK_BATCH_SIZE) {
        const batch = selected.slice(i, i + BULK_BATCH_SIZE);
        const res = await fetch("/api/materials/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vault,
            pillar: pillar.trim() || undefined,
            items: batch.map((n) => ({
              path: n.path,
              title: n.title,
              summary: n.summary,
              content: n.content,
              tags: n.tags,
              pillar: n.pillar,
              url: n.url,
              published_at: n.published_at,
            })),
          }),
        });
        const data = await res.json().catch(() => null);
        if (res.status === 403) throw new Error(data?.error || "当前站点为只读模式，无法导入");
        if (!res.ok) throw new Error(data?.error || "导入失败，请重试");
        created += data.created ?? 0;
        skipped += data.skipped ?? 0;
        failed += (data.failed?.length as number) ?? 0;
        if (Array.isArray(data.materials) && data.materials.length > 0) {
          onImported(data.materials as MaterialCard[]);
        }
        setProgress({ done: Math.min(i + batch.length, selected.length), total: selected.length });
      }
      setResult({ created, skipped, failed });
      setNotes([]);
      setExcluded(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败，请重试");
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="space-y-3">
      {/* 投喂区：拖拽 + 两个选择按钮 */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
          dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25"
        }`}
      >
        <Upload className="mx-auto mb-2 size-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          把文件夹或笔记文件拖到这里，或者
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => dirInput.current?.click()}>
            <FolderOpen /> 选择文件夹
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
            <FileText /> 选择文件
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          只读取 .md / .markdown / .mdx / .txt，自动跳过 .obsidian、附件与隐藏目录；
          文件在浏览器本地解析，只发往你自己的这份部署。
        </p>
        <input
          ref={dirInput}
          type="file"
          multiple
          hidden
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []).map((f) => ({ path: relPathOf(f), file: f }));
            e.target.value = "";
            await ingestFiles(files);
          }}
        />
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          accept=".md,.markdown,.mdx,.txt,text/markdown,text/plain"
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []).map((f) => ({ path: relPathOf(f), file: f }));
            e.target.value = "";
            await ingestFiles(files);
          }}
        />
      </div>

      {reading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> 正在读取并解析文件…
        </p>
      )}

      {notes.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="secondary">{vault}</Badge>
            <span className="text-muted-foreground">
              解析到 {notes.length} 篇，待导入 {selected.length} 篇
              {ignoredCount > 0 && `（已跳过 ${ignoredCount} 个非笔记文件）`}
            </span>
            {selected.length !== notes.length && (
              <Button variant="ghost" size="sm" onClick={() => setExcluded(new Set())}>
                全选
              </Button>
            )}
          </div>

          {/* 预览列表：逐条可剔除，板块默认取笔记所在的首层目录名 */}
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
            {notes.map((n) => {
              const off = excluded.has(n.path);
              return (
                <div
                  key={n.path}
                  className={`flex items-center gap-2 rounded px-2 py-1 text-sm ${off ? "opacity-40" : ""}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{n.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {n.path} · {n.chars} 字
                      {n.pillar && ` · ${n.pillar}`}
                      {n.tags.length > 0 && ` · #${n.tags.slice(0, 3).join(" #")}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={off ? "恢复该条" : "不导入该条"}
                    onClick={() =>
                      setExcluded((prev) => {
                        const next = new Set(prev);
                        if (next.has(n.path)) next.delete(n.path);
                        else next.add(n.path);
                        return next;
                      })
                    }
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              );
            })}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">统一板块（可选）</label>
            <Input
              value={pillar}
              onChange={(e) => setPillar(e.target.value)}
              placeholder="留空则按笔记所在的首层文件夹自动归类"
              list="bulk-pillar-options"
            />
            <datalist id="bulk-pillar-options">
              {pillarOptions.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
        </>
      )}

      {progress && (
        <p className="text-sm text-muted-foreground">
          导入中… {progress.done} / {progress.total}
        </p>
      )}
      {result && (
        <p className="text-sm">
          导入完成：新增 {result.created} 条
          {result.skipped > 0 && `，跳过 ${result.skipped} 条（同路径已导入过）`}
          {result.failed > 0 && `，失败 ${result.failed} 条`}
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          关闭
        </Button>
        <Button onClick={submit} disabled={selected.length === 0 || !!progress || reading}>
          {progress ? "导入中…" : `导入 ${selected.length} 篇`}
        </Button>
      </div>
    </div>
  );
}
