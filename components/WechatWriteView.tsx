"use client";

/**
 * 公众号预览「可写模式」：右侧排版视图里直接改稿。
 *
 * 为什么不是 contentEditable：渲染产物是满屏 <section style> 的公众号 HTML，
 * 反解回 Markdown 极易丢结构（列表、加粗、图注、脚注），中文输入法与富文本粘贴
 * 还会带进一堆脏节点。这里改成「点哪块开哪块的 Markdown 源」：
 *
 * - `renderMarkdownBlocks` 把正文按顶层块切开，块与 Markdown 源严格一一对应；
 * - 点一块 → 原位展开一个只装这一块源码的小编辑框，改完 400ms 防抖写回整篇正文，
 *   左侧编辑区、脏标记、保存、AI 链路全部沿用原有那一份 content 状态；
 * - 悬停出工具条：上移 / 下移 / 下方插入 / 删除，排版打磨不用回左边数段落。
 *
 * 与「预览模式」的两个差异（都写在界面提示里）：
 * ① 可写模式按正文原始段落渲染，不做呼吸感重排（reflowProse）——重排是按文本
 *    哈希随机拆句的，改一个字整段边界就会跳动，编辑时会晃眼。想让预览与复制结果
 *    完全一致，用头部的「固化重排」把重排写进正文。
 * ② 复制到公众号/小红书/推特仍走 renderMarkdown 的整段输出，剪贴板里不会有
 *    这里的块外壳 div。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderMarkdownBlocks, type RenderOptions } from "@/lib/wemark/renderer";
import { stripReferences } from "@/lib/format";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

interface BlockRange {
  start: number;
  end: number;
}

/** 新插入段落的占位文字（打开编辑框时整体选中，直接打字即替换） */
const NEW_BLOCK_TEXT = "新段落";

/** 主题 container 的内联样式字符串 → React style 对象 */
function cssTextToStyle(css: string): React.CSSProperties {
  const style: Record<string, string> = {};
  for (const decl of css.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const key = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim();
    if (!key || !value) continue;
    style[key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
  }
  return style as React.CSSProperties;
}

// AI 生成的配图以 data URI 内嵌在正文里，一张几十 KB 的 base64 会把源码框糊满。
// 编辑时折成占位符，写回前还原；用户主动删掉占位符就是删掉那张图（符合预期）。
const DATA_URI_RE = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g;

function foldImages(raw: string): { text: string; uris: string[] } {
  const uris: string[] = [];
  const text = raw.replace(DATA_URI_RE, (m) => {
    uris.push(m);
    return `«内嵌图片${uris.length}»`;
  });
  return { text, uris };
}

function unfoldImages(text: string, uris: string[]): string {
  return text.replace(/«内嵌图片(\d+)»/g, (m, n: string) => uris[Number(n) - 1] ?? m);
}

export function WechatWriteView({
  content,
  title,
  options,
  onContentChange,
  onTitleChange,
}: {
  content: string;
  title: string;
  options: RenderOptions;
  onContentChange: (next: string) => void;
  onTitleChange?: (next: string) => void;
}) {
  // 预览渲染的正文：剔掉「参考资料」段（与预览模式一致），但不做呼吸感重排
  const previewMd = useMemo(() => stripReferences(content ?? ""), [content]);

  const rendered = useMemo(() => {
    try {
      return renderMarkdownBlocks(previewMd, options);
    } catch (e) {
      console.error("[wechat-write] 渲染失败", e);
      return { containerStyle: "", blocks: [], tailHtml: "" };
    }
  }, [previewMd, options]);

  const containerStyle = useMemo(() => cssTextToStyle(rendered.containerStyle), [rendered.containerStyle]);

  // 每块的 Markdown 源在整篇 content 里的字符区间：顺序扫描 indexOf。
  // stripReferences 只删整行、折空行、trim，不改行内文字，所以块源码一定原样
  // 出现在 content 里；万一定位失败（极端情况）该块降级为只读，绝不写错位置。
  const ranges = useMemo<(BlockRange | null)[]>(() => {
    const out: (BlockRange | null)[] = [];
    let cursor = 0;
    for (const b of rendered.blocks) {
      const at = content.indexOf(b.raw, cursor);
      if (at < 0) {
        out.push(null);
        continue;
      }
      cursor = at + b.raw.length;
      out.push({ start: at, end: at + b.raw.length });
    }
    return out;
  }, [rendered.blocks, content]);

  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [selectOnFocus, setSelectOnFocus] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);

  const draftRef = useRef("");
  const foldedRef = useRef<string[]>([]);
  // 当前草稿在 content 里占据的区间：每次写回后自己更新，不再依赖重新分块的结果。
  // 若跟着 ranges 走，用户在块里敲一个空行把它拆成两块时区间会缩短，下一次写回
  // 就会把整段草稿塞进前半块 → 正文重复。
  const rangeRef = useRef<BlockRange | null>(null);
  const contentRef = useRef(content);
  const selfWriteRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  const applyContent = useCallback(
    (next: string) => {
      if (next === contentRef.current) return;
      selfWriteRef.current = next;
      contentRef.current = next;
      onContentChange(next);
    },
    [onContentChange],
  );

  /** 把当前草稿写回正文（防抖到期、失焦、切块、卸载时都走这里） */
  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const r = rangeRef.current;
    if (!r) return;
    const md = unfoldImages(draftRef.current, foldedRef.current);
    const c = contentRef.current;
    const next = c.slice(0, r.start) + md + c.slice(r.end);
    rangeRef.current = { start: r.start, end: r.start + md.length };
    applyContent(next);
  }, [applyContent]);

  // 正文被外部改掉（左侧编辑区、AI 修改/配图、撤销）→ 关掉编辑态。
  // 草稿区间是按旧正文算的，继续写回会串到别处。
  useEffect(() => {
    if (selfWriteRef.current === content) return;
    selfWriteRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    rangeRef.current = null;
    setEditing(null);
  }, [content]);

  // 退出可写模式（组件卸载）前把未落地的草稿写回，别让用户白改
  useEffect(() => {
    return () => {
      if (timerRef.current) flush();
    };
  }, [flush]);

  /**
   * 取第 i 块在**当前**正文里的区间，并校验那段字符确实还是这一块的源码。
   * 上一块的草稿刚落地（点工具条会先触发编辑框失焦 → 写回）时，本次点击闭包里的
   * ranges 可能是写回前算的，位置已经偏了——校验不过就整个放弃这次操作，
   * 下一次渲染后再点即正常，绝不按错位区间改正文。
   */
  const resolveRange = useCallback(
    (i: number): BlockRange | null => {
      const r = ranges[i];
      if (!r) return null;
      if (contentRef.current.slice(r.start, r.end) !== rendered.blocks[i].raw) return null;
      return r;
    },
    [ranges, rendered.blocks],
  );

  const open = useCallback(
    (i: number) => {
      if (editing === i) return;
      if (editing !== null) flush();
      const r = resolveRange(i);
      if (!r) return; // 定位失败或正文刚变过：这块暂不可编辑
      const { text, uris } = foldImages(rendered.blocks[i].raw);
      foldedRef.current = uris;
      rangeRef.current = r;
      draftRef.current = text;
      setDraft(text);
      setSelectOnFocus(false);
      setEditing(i);
    },
    [editing, flush, resolveRange, rendered.blocks],
  );

  const close = useCallback(() => {
    flush();
    rangeRef.current = null;
    setEditing(null);
  }, [flush]);

  const onDraftChange = useCallback(
    (v: string) => {
      draftRef.current = v;
      setDraft(v);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, 400);
    },
    [flush],
  );

  /** 与相邻块交换位置（分隔空行原样留在中间） */
  const moveBlock = useCallback(
    (i: number, dir: -1 | 1) => {
      const j = i + dir;
      const a = resolveRange(Math.min(i, j));
      const b = resolveRange(Math.max(i, j));
      if (!a || !b) return;
      const c = contentRef.current;
      const sep = c.slice(a.end, b.start) || "\n\n";
      applyContent(
        c.slice(0, a.start) + c.slice(b.start, b.end) + sep + c.slice(a.start, a.end) + c.slice(b.end),
      );
      setEditing(null);
    },
    [resolveRange, applyContent],
  );

  const removeBlock = useCallback(
    (i: number) => {
      const r = resolveRange(i);
      if (!r) return;
      if (!confirm("删除这一段？（左侧正文同步删除，保存前可撤销）")) return;
      const c = contentRef.current;
      applyContent((c.slice(0, r.start) + c.slice(r.end)).replace(/\n{3,}/g, "\n\n").trim());
      setEditing(null);
    },
    [resolveRange, applyContent],
  );

  /** 在某块下方插入一个新段落，并直接打开它的编辑框（占位文字整体选中） */
  const insertAfter = useCallback(
    (i: number) => {
      const r = resolveRange(i);
      if (!r) return;
      if (editing !== null) flush();
      const c = contentRef.current;
      const start = r.end + 2;
      applyContent(c.slice(0, r.end) + "\n\n" + NEW_BLOCK_TEXT + c.slice(r.end));
      foldedRef.current = [];
      rangeRef.current = { start, end: start + NEW_BLOCK_TEXT.length };
      draftRef.current = NEW_BLOCK_TEXT;
      setDraft(NEW_BLOCK_TEXT);
      setSelectOnFocus(true);
      setEditing(i + 1);
    },
    [resolveRange, editing, flush, applyContent],
  );

  const rows = Math.min(24, Math.max(3, draft.split("\n").length + 1));

  return (
    <>
      {/* 标题：可写模式下点一下就地改（写回稿件标题字段） */}
      {onTitleChange ? (
        editingTitle ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            onBlur={() => setEditingTitle(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") setEditingTitle(false);
            }}
            className="mb-1 w-full rounded-md border border-sky-300 px-1.5 py-1 text-[19px] font-bold leading-snug text-zinc-900 outline-none"
          />
        ) : (
          <h1
            onClick={() => setEditingTitle(true)}
            title="点击修改标题"
            className="mb-1 cursor-text rounded-md border-b border-zinc-100 pb-3 text-[19px] font-bold leading-snug text-zinc-900 outline-1 outline-dashed outline-transparent hover:outline-sky-400/60"
          >
            {title || <span className="text-zinc-300">点击填写标题</span>}
          </h1>
        )
      ) : (
        title && (
          <h1 className="mb-1 border-b border-zinc-100 pb-3 text-[19px] font-bold leading-snug text-zinc-900">
            {title}
          </h1>
        )
      )}

      <div style={containerStyle}>
        {rendered.blocks.map((b, i) => {
          if (editing === i) {
            return (
              <div key={i} className="my-2 rounded-lg bg-sky-50/60 p-1.5">
                <textarea
                  autoFocus
                  rows={rows}
                  value={draft}
                  onFocus={(e) => {
                    if (selectOnFocus) {
                      e.currentTarget.select();
                      setSelectOnFocus(false);
                    }
                  }}
                  onChange={(e) => onDraftChange(e.target.value)}
                  onBlur={close}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" || ((e.metaKey || e.ctrlKey) && e.key === "Enter")) {
                      e.preventDefault();
                      close();
                    }
                  }}
                  className="w-full resize-y rounded-md border border-sky-400 bg-white p-2 font-mono text-[13px] leading-relaxed text-zinc-800 outline-none"
                />
                <p className="mt-1 px-1 text-[11px] text-zinc-500">
                  改的是这一段的 Markdown 源 · Esc / ⌘Enter 收起 · 实时同步左侧，记得点保存
                </p>
              </div>
            );
          }
          const editable = ranges[i] !== null;
          return (
            <div
              key={i}
              data-md-block={i}
              onClick={() => editable && open(i)}
              title={editable ? "点击编辑这一段" : "这一段定位失败，请在左侧编辑区修改"}
              className={
                "group relative rounded-md outline-1 outline-dashed outline-transparent transition-[outline-color] " +
                (editable ? "cursor-text hover:outline-sky-400/60" : "cursor-default")
              }
            >
              <div dangerouslySetInnerHTML={{ __html: b.html }} />
              {editable && (
                <div className="absolute -top-3 right-0 z-10 flex items-center gap-0.5 rounded-md border border-zinc-300 bg-white px-0.5 opacity-0 shadow-md transition-opacity group-hover:opacity-100">
                  <ToolBtn label="上移" disabled={i === 0} onClick={() => moveBlock(i, -1)}>
                    <ArrowUp className="size-3.5" />
                  </ToolBtn>
                  <ToolBtn
                    label="下移"
                    disabled={i === rendered.blocks.length - 1}
                    onClick={() => moveBlock(i, 1)}
                  >
                    <ArrowDown className="size-3.5" />
                  </ToolBtn>
                  <ToolBtn label="下方插入段落" onClick={() => insertAfter(i)}>
                    <Plus className="size-3.5" />
                  </ToolBtn>
                  <ToolBtn label="删除这一段" danger onClick={() => removeBlock(i)}>
                    <Trash2 className="size-3.5" />
                  </ToolBtn>
                </div>
              )}
            </div>
          );
        })}
        {rendered.tailHtml && <div dangerouslySetInnerHTML={{ __html: rendered.tailHtml }} />}
        {rendered.blocks.length === 0 && (
          <p className="py-8 text-center text-sm text-zinc-400">正文还是空的，去左侧写点东西</p>
        )}
      </div>
    </>
  );
}

/** 块悬停工具条上的小按钮（白底容器里，颜色写死不跟随深色主题） */
function ToolBtn({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={
        "rounded p-1 transition-colors disabled:opacity-30 " +
        (danger
          ? "text-zinc-500 hover:bg-red-50 hover:text-red-600"
          : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900")
      }
    >
      {children}
    </button>
  );
}
