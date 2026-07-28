import type { Draft } from "./types";

// 纯函数：把稿件格式化成「可直接复制粘贴」的文本。客户端/服务端通用，无副作用。

// 通用字符计数（每字符占 1，用于公众号/抖音等按字数计的场景）
export function charCount(text: string): number {
  return Array.from(text ?? "").length;
}

// 相对时间：24 小时内给"x 分钟/小时前"，一周内给"x 天前"，更早给具体日期。
// 客户端渲染时若在 SSR 输出中使用，注意加 suppressHydrationWarning。
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const ts = new Date(iso).getTime();
  if (!ts) return "";
  const diffMin = Math.floor((Date.now() - ts) / 60000);
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h} 小时前`;
  const day = Math.floor(h / 24);
  if (day < 7) return `${day} 天前`;
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return sameYear
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

// 复制/渲染输出里要剔除的「参考文献」类小标题（名词注释不在此列，保留）。
// 只认整段小标题正好是这些词，避免误伤正文里带「参考」二字的普通句子。
const REF_HEADING = /^(参考资料|参考文献|参考链接|参考来源|引用来源|资料来源|引用|references?|sources?)\s*$/i;

/**
 * 从 Markdown 里剔除「参考资料 / 参考文献」整段（含小标题及其下所有内容，直到遇到同级或更高级
 * 小标题、或文末）。用于三种平台（公众号/小红书/抖音）的**复制与预览输出**——参考文献列表对读者
 * 是噪音，不该带进成品；但**名词注释保留**（它的小标题不匹配 REF_HEADING）。
 *
 * 只作用于复制/渲染出去的那份文本，**不改动数据库里的稿件正文**（编辑区仍留着参考资料）。
 * 纯函数，前后端通用，不依赖 DOM。
 */
export function stripReferences(md: string): string {
  const lines = (md ?? "").replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let skipLevel = 0; // >0 表示正处在被剔除的参考文献段里，值为该段小标题的级别

  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.*?)\s*$/);
    if (skipLevel > 0) {
      // 遇到同级或更高级小标题 → 参考文献段结束，这一行照常处理
      if (h && h[1].length <= skipLevel) {
        skipLevel = 0;
      } else {
        continue; // 仍在参考文献段内，整行丢弃
      }
    }
    if (h && REF_HEADING.test(h[2])) {
      skipLevel = h[1].length; // 进入剔除区
      continue;
    }
    out.push(line);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ── 正文重排（reflow）：把长段落按中文句末标点拆成「每段 1~2 句」的短段 ──────────
// 只作用于**公众号预览与复制的渲染输入**，不落库、不碰小红书/抖音正文。目的是让读者
// 观感更松弛（段短、段间留白）。分组随机但**确定性**（种子取自段落文本），保证预览与
// 复制出的分段完全一致、重渲染不跳动。

// 句末终止符（只认全角，ASCII 的 . 不切——正文里的 . 多来自小数、URL、英文缩写）
const SENTENCE_ENDERS = new Set(["。", "！", "？", "…"]);
// 跟在句末标点后、应一并吸入本句的闭合引号/括号
const SENTENCE_CLOSERS = new Set(["」", "』", "”", "’", "）", "》", "】", '"', "'"]);

// FNV-1a 32bit 哈希 → 供确定性随机取种子
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32：种子确定则序列确定
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 行内 Markdown 跨度是否闭合：** 加粗、* 斜体、` 代码、[]() 链接。
// 句末标点落在未闭合的跨度里时不能断段，否则会切出未闭合的加粗/链接把渲染搞坏。
function inlineBalanced(s: string): boolean {
  // ** 加粗与 * 斜体必须分开计数。曾经统一按「星号总数取奇偶」判断，
  // 但一个**未闭合**的 ** 自带两个星号，2 % 2 === 0 恒成立，于是
  // 「…机制：**你白拿到…的痛。** 大脑把…」会在中间那个句号处被断开，
  // 切出两段各带一个孤立 **，marked 无法配对，** 就漏成字面量显示给用户。
  const bold = (s.match(/\*\*/g) ?? []).length;
  const italic = (s.replace(/\*\*/g, "").match(/\*/g) ?? []).length;
  const tick = (s.match(/`/g) ?? []).length;
  const lb = (s.match(/\[/g) ?? []).length;
  const rb = (s.match(/\]/g) ?? []).length;
  const lp = (s.match(/\(/g) ?? []).length;
  const rp = (s.match(/\)/g) ?? []).length;
  return bold % 2 === 0 && italic % 2 === 0 && tick % 2 === 0 && lb === rb && lp === rp;
}

// 把一段正文文本切成句子数组（保护行内跨度、吸收连续终止符与闭合符号）
function splitSentences(text: string): string[] {
  const chars = Array.from(text);
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < chars.length; i++) {
    cur += chars[i];
    if (!SENTENCE_ENDERS.has(chars[i])) continue;
    // 吸收紧随其后的终止符（……、。」）与闭合引号括号
    while (
      i + 1 < chars.length &&
      (SENTENCE_ENDERS.has(chars[i + 1]) || SENTENCE_CLOSERS.has(chars[i + 1]))
    ) {
      cur += chars[++i];
    }
    // 只有行内跨度平衡时才在此断句
    if (inlineBalanced(cur)) {
      if (cur.trim()) out.push(cur);
      cur = "";
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// 单个普通段落 → 按「随机 1~2 句一段」重排；不足两句则原样返回
function reflowParagraph(text: string): string {
  const sentences = splitSentences(text);
  if (sentences.length <= 1) return text.trim();
  const rng = mulberry32(hashStr(text));
  const paras: string[] = [];
  let i = 0;
  while (i < sentences.length) {
    const take = rng() < 0.5 ? 1 : 2; // 随机 1 或 2 句
    const chunk = sentences.slice(i, i + take).join("").trim();
    if (chunk) paras.push(chunk);
    i += take;
  }
  return paras.join("\n\n");
}

/**
 * 把 Markdown 正文里的**普通段落**按句末标点拆成「每段 1~2 句」的短段，段间空行。
 * 标题、图片、列表、引用、表格、分隔线、代码块、HTML 行一律原样保留并作为段边界，
 * 只重排纯文本段落。纯函数、无 DOM 依赖，前后端通用。
 */
export function reflowProse(md: string): string {
  const lines = (md ?? "").replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inFence = false; // 处于 ``` / ~~~ 代码块内
  let buf: string[] = []; // 累积的连续普通正文行

  const flush = () => {
    if (buf.length === 0) return;
    out.push(reflowParagraph(buf.join("")));
    buf = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    // 代码围栏开关：栏内内容一律原样，句号不碰
    if (/^(```|~~~)/.test(trimmed)) {
      flush();
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    // 块级结构与空行 → 段边界，原样输出
    const isBlock =
      trimmed === "" ||
      /^#{1,6}\s/.test(trimmed) || // 标题
      /^!\[/.test(trimmed) || // 图片
      /^>/.test(trimmed) || // 引用
      /^([-*+]\s|\d+[.)]\s)/.test(trimmed) || // 列表
      /^\|/.test(trimmed) || // 表格
      /^(-{3,}|\*{3,}|_{3,})$/.test(trimmed) || // 分隔线
      /^<\/?[a-zA-Z]/.test(trimmed); // HTML 行
    if (isBlock) {
      flush();
      out.push(line);
      continue;
    }
    buf.push(line);
  }
  flush();

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// 「复制全部」时的完整文本（当前只有公众号：标题作一级标题 + 正文）
export function formatForCopy(
  draft: Pick<Draft, "platform" | "title" | "content" | "meta">,
): string {
  const content = (draft.content ?? "").trim();
  const title = draft.title ? `# ${draft.title.trim()}\n\n` : "";
  return `${title}${content}`;
}
