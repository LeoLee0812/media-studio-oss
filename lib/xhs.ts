/**
 * 小红书长文渲染器：Markdown → 小红书长文编辑器吃得下的「语义化 HTML」。
 *
 * 为什么不能复用 WeMark 那套内联样式 HTML：
 * 小红书长文编辑器（creator.xiaohongshu.com「写长文」）是 Tiptap / ProseMirror，
 * 粘贴时走 schema 白名单解析，**只认语义标签、完全无视内联 style**。
 * 公众号那套满是 <section style> / <span style> 的 HTML 粘过去会被剥成纯文本，
 * 这就是「从公众号复制到小红书变纯文本、很丑」的根因。
 *
 * 2026-07-14 在真实编辑器里派发 paste 事件逐个标签实测出的 schema 白名单：
 *   ✅ 保留：h1 · h2 · p · ul/li · ol/li · blockquote · mark
 *   ❌ 剥成纯文本：strong/b（加粗）· em/i（斜体）· a（链接）· code/pre · span[style]
 *   ❌ 直接丢弃：img（外链图粘不进，小红书没有公众号那种「粘贴自动转存外链图」的机制）
 *   ⬇️ 降级：h3 及以下 → 普通段落
 *
 * 由此推出两条关键设计：
 * 1. **加粗 → 高亮**：小红书没有加粗，唯一的行内强调手段就是 <mark>（工具栏「划重点」）。
 *    所以把 markdown 的 **加粗** 直接映射成 <mark>，正文的「精华部分」自动变成醒目黄底。
 * 2. **h3+ 提升为 h2**：h3 会被降级成普通段落，白丢一层结构，不如就近提升。
 *
 * 另注：ProseMirror 的 input rules（键入「1. 」自动变醒目序号）只响应逐字符键入，
 * 不响应粘贴——所以纯文本里塞 markdown 符号那条路是死的，必须走 text/html。
 */
import { marked } from "marked";

marked.use({ gfm: true, breaks: true });

/** 单段高亮的字数上限：超过这个长度就不高亮了，否则满屏黄底反而不醒目 */
const MAX_MARK_LEN = 40;

// ===== 段落编号（emoji 定位用，前后端共用） =====
//
// 服务端按这套编号把正文喂给模型（「[3] 这段的内容…」），模型只回 { index, emoji }，
// 前端再按同一套编号把 emoji 插回 markdown。让模型回编号而不是回原文锚点，
// 输出量小一个数量级——40 多个段落逐条吐锚点会把 flash 的响应拖到两分钟以上。
// 两边必须走同一个函数，编号错位就会把 emoji 插到别的段落上。

/** 是不是「普通正文段落」：标题、图片、列表、引用、代码块都不配 emoji */
function isProsePara(block: string): boolean {
  const t = block.trim();
  if (!t) return false;
  return !/^(#{1,6}\s|!\[|>|[-*+]\s|\d+\.\s|```|\||---)/.test(t);
}

/** 把 markdown 切成块，并给「普通正文段落」编号 */
export function numberedParagraphs(md: string): { index: number; text: string }[] {
  const blocks = (md ?? "").split(/\n{2,}/);
  const out: { index: number; text: string }[] = [];
  blocks.forEach((block, i) => {
    if (isProsePara(block)) out.push({ index: i, text: block.trim() });
  });
  return out;
}

/** emoji 落点：段首或段尾（模型按语感选，句号后的段尾 emoji 更像随手打的） */
export type EmojiPos = "start" | "end";

export interface ParaEmoji {
  index: number;
  emoji: string;
  /** 缺省按段首处理（兼容旧缓存里没有 pos 的数据） */
  pos?: EmojiPos;
}

/** 按编号把 emoji 插到段首或段尾（markdown 层面，渲染前做） */
export function injectEmojis(md: string, emojis: ParaEmoji[]): string {
  if (!emojis.length) return md ?? "";
  const map = new Map(emojis.map((e) => [e.index, e]));
  return (md ?? "")
    .split(/\n{2,}/)
    .map((block, i) => {
      const item = map.get(i);
      if (!item || !isProsePara(block)) return block;
      if (item.pos === "end") return `${block.trimEnd()} ${item.emoji}`;
      return `${item.emoji} ${block.trimStart()}`;
    })
    .join("\n\n");
}

/**
 * 正文指纹（FNV-1a 32 位 ×2 拼接）：小红书「醒目化」结果的缓存键，前后端共用。
 * 前端用它判断服务端缓存是否还对得上当前编辑区的正文；不求密码学强度，防碰撞够用。
 */
export function xhsContentHash(md: string): string {
  const s = md ?? "";
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((c << 1) | 1), 0x01000193) >>> 0;
  }
  return `${h1.toString(16)}-${h2.toString(16)}`;
}

export interface XhsRenderOptions {
  /** 图片粘不进小红书，是否在原位留一行「📷 配图N：图注」提示，方便手动补图 */
  imageHints: boolean;
  /**
   * AI 挑出来的高亮片段（/api/drafts/[id]/xhs-highlight）。
   * 无粗体、无小标题的长文风格稿子，光靠「加粗→高亮」一处高亮都出不来，
   * 得靠这个把每段的「文眼」标出来，否则复制过去就是一堵墙。
   */
  highlights: string[];
  /**
   * AI 给部分段落配的 emoji，按段落编号插到段首/段尾（见上面的 numberedParagraphs / injectEmojis）。
   * emoji 是小红书的原生语感，但它是配角：只给情绪或信息浓度高的段落点缀，不必每段都有。
   */
  emojis: ParaEmoji[];
}

export const XHS_DEFAULT_OPTIONS: XhsRenderOptions = {
  imageHints: true,
  highlights: [],
  emojis: [],
};

export interface XhsRenderResult {
  /** 写进剪贴板 text/html 的语义化 HTML（小红书长文编辑器主通道） */
  html: string;
  /** 写进剪贴板 text/plain 的 emoji 排版纯文本（手机 App / 普通笔记的兜底通道） */
  plain: string;
  /** 高亮处数量，给 UI 反馈用 */
  markCount: number;
  /** 插进段首的 emoji 数量，给 UI 反馈用 */
  emojiCount: number;
  /** 被丢弃的图片数量，给 UI 反馈用 */
  imageCount: number;
}

/** 把元素替换成它的子节点（脱掉标签、保留内容） */
function unwrap(el: Element) {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

/** 把元素整个换成一个新标签，内容原样搬过去 */
function rename(doc: Document, el: Element, tag: string): Element {
  const next = doc.createElement(tag);
  while (el.firstChild) next.appendChild(el.firstChild);
  el.replaceWith(next);
  return next;
}

/**
 * 核心：把 marked 产出的通用 HTML 收敛到小红书 schema 白名单。
 * 凡是白名单外的标签，一律「脱标签保文字」，绝不留下会被小红书剥掉的空壳。
 */
function toXhsSchema(doc: Document, opts: XhsRenderOptions): { markCount: number; imageCount: number } {
  const body = doc.body;
  let imageCount = 0;

  // 1. 图片：粘不进去，按需换成提示行，否则直接删
  body.querySelectorAll("img").forEach((img) => {
    imageCount += 1;
    const caption = img.getAttribute("alt")?.trim() || "";
    if (opts.imageHints) {
      const hint = doc.createElement("p");
      hint.textContent = `📷 配图${imageCount}${caption ? `：${caption}` : ""}`;
      // 图片常被 <p> 或 <figure> 单独包着，提示行要顶到那一层去，避免留下空段落
      const holder = img.closest("figure, p") ?? img;
      holder.replaceWith(hint);
    } else {
      (img.closest("figure, p") ?? img).remove();
    }
  });
  // figcaption 若还残留（figure 没被上面吃掉的情况），并进正文
  body.querySelectorAll("figcaption").forEach((el) => rename(doc, el, "p"));

  // 2. 加粗 → 高亮（小红书唯一的行内强调手段）
  let markCount = 0;
  body.querySelectorAll("strong, b").forEach((el) => {
    const text = el.textContent ?? "";
    // 空的、或长到整段的，高亮了反而糊，直接脱标签保文字
    if (!text.trim() || text.length > MAX_MARK_LEN) {
      unwrap(el);
      return;
    }
    rename(doc, el, "mark");
    markCount += 1;
  });

  // 3. 标题：h1/h2 保留，h3 及以下就近提升为 h2（否则会被小红书降级成普通段落，白丢结构）
  body.querySelectorAll("h3, h4, h5, h6").forEach((el) => rename(doc, el, "h2"));

  // 4. 白名单外的行内标签：脱标签保文字（em/a/code/del/span/sub/sup…）
  //    小红书会剥掉它们，我们主动剥干净，免得留下奇怪的空壳
  body.querySelectorAll("em, i, a, code, del, s, span, sub, sup, u, small").forEach((el) => unwrap(el));

  // 5. 代码块 → 普通段落（保留代码文字本身）
  body.querySelectorAll("pre").forEach((pre) => {
    const p = doc.createElement("p");
    p.textContent = pre.textContent ?? "";
    pre.replaceWith(p);
  });

  // 6. 分隔线 → 小红书没有 hr，用一行居中符号代替
  body.querySelectorAll("hr").forEach((hr) => {
    const p = doc.createElement("p");
    p.textContent = "· · ·";
    hr.replaceWith(p);
  });

  // 7. 表格 → 拍平成「表头：值」的段落（小红书 schema 没有表格）
  body.querySelectorAll("table").forEach((table) => {
    const lines: string[] = [];
    table.querySelectorAll("tr").forEach((tr) => {
      const cells = [...tr.querySelectorAll("th, td")].map((c) => (c.textContent ?? "").trim());
      if (cells.some(Boolean)) lines.push(cells.join(" ｜ "));
    });
    const frag = doc.createDocumentFragment();
    lines.forEach((line) => {
      const p = doc.createElement("p");
      p.textContent = line;
      frag.appendChild(p);
    });
    table.replaceWith(frag);
  });

  // 8. 任务列表的 checkbox（GFM 产物）：换成符号，input 标签小红书不认
  body.querySelectorAll('input[type="checkbox"]').forEach((box) => {
    const done = box.hasAttribute("checked");
    box.replaceWith(doc.createTextNode(done ? "✅ " : "⬜️ "));
  });

  // 9. 清掉所有属性（class/style/id 全是噪音，小红书一概不认）
  body.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((attr) => el.removeAttribute(attr.name));
  });

  // 10. 扫掉空段落（上面几步可能留下空壳）
  body.querySelectorAll("p").forEach((p) => {
    if (!(p.textContent ?? "").trim() && !p.querySelector("mark")) p.remove();
  });

  return { markCount, imageCount };
}

/**
 * 把 AI 挑出的片段包成 <mark>。
 * 片段来自正文原文（服务端已逐字校验过），这里只在正文的文本节点里定位，不改动任何文字。
 * 跳过标题（本身够醒目）和已经高亮过的地方，避免嵌套 mark。
 */
function applyHighlights(doc: Document, phrases: string[]): number {
  let count = 0;
  // 长的先匹配：否则短片段先占了位，长片段就再也找不到完整的落点了
  const ordered = [...phrases].sort((a, b) => b.length - a.length);

  for (const phrase of ordered) {
    if (!phrase) continue;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let hit: Text | null = null;
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (!node.data.includes(phrase)) continue;
      // 标题里不再高亮；已在 mark 里的也跳过（不嵌套）
      const parent = node.parentElement;
      if (parent?.closest("h1, h2, mark")) continue;
      hit = node;
      break;
    }
    if (!hit) continue;

    const idx = hit.data.indexOf(phrase);
    const tail = hit.splitText(idx);          // tail 以 phrase 开头
    tail.splitText(phrase.length);            // 把 phrase 之后的部分切出去，tail 正好是 phrase
    const mark = doc.createElement("mark");
    tail.replaceWith(mark);
    mark.appendChild(tail);
    count += 1;
  }
  return count;
}

/**
 * 纯文本兜底版：小红书手机 App 发普通笔记时用不了 HTML，
 * 这里按国内自媒体通行的 emoji 排版法把结构编码进纯文本（emoji 本身就是普通字符，永远不会被剥）。
 */
function toXhsPlain(doc: Document): string {
  const out: string[] = [];
  const numberEmoji = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

  doc.body.childNodes.forEach((node) => {
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const text = (el.textContent ?? "").trim();
    if (!text) return;

    switch (tag) {
      case "h1":
      case "h2":
        out.push(`📌 ${text}`);
        break;
      case "blockquote":
        out.push(`💬 ${text}`);
        break;
      case "ul":
        el.querySelectorAll(":scope > li").forEach((li) => {
          out.push(`▪️ ${(li.textContent ?? "").trim()}`);
        });
        break;
      case "ol":
        [...el.querySelectorAll(":scope > li")].forEach((li, i) => {
          const prefix = numberEmoji[i] ?? `${i + 1}.`;
          out.push(`${prefix} ${(li.textContent ?? "").trim()}`);
        });
        break;
      default:
        out.push(text);
    }
  });

  // 段落之间空一行，小红书信息流靠留白撑视觉呼吸感
  return out.join("\n\n");
}

/** Markdown → 小红书长文（HTML 主通道 + emoji 纯文本兜底通道）。仅浏览器端可用（依赖 DOMParser） */
export function renderXhs(md: string, opts: XhsRenderOptions = XHS_DEFAULT_OPTIONS): XhsRenderResult {
  const emojis = opts.emojis ?? [];
  // emoji 在 markdown 层插（段首），再交给 marked——高亮片段取自段落中间，不受段首多出的 emoji 影响
  const withEmoji = injectEmojis(md ?? "", emojis);

  const raw = marked.parse(withEmoji, { async: false }) as string;
  const doc = new DOMParser().parseFromString(`<body>${raw}</body>`, "text/html");

  const { markCount, imageCount } = toXhsSchema(doc, opts);
  const aiMarks = applyHighlights(doc, opts.highlights ?? []);

  return {
    html: doc.body.innerHTML,
    plain: toXhsPlain(doc),
    markCount: markCount + aiMarks,
    emojiCount: emojis.length,
    imageCount,
  };
}
