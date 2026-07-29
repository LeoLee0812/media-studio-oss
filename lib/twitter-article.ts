/**
 * 推特长篇（X Articles）渲染器：Markdown → X 文章编辑器吃得下的「裸语义化 HTML」。
 *
 * 为什么又是独立一套，不能复用公众号/小红书那两份：
 * X 的文章编辑器（x.com/compose/articles/edit/<id>）是 **Draft.js**（X 自己 fork 的
 * twitter-forks/draft-js），DOM 特征 `public-DraftEditor-content`，块类型前缀 `longform-*`。
 * Draft.js 粘贴走 `convertFromHTMLToContentBlocks`：按 blockRenderMap 逐个块级标签映射，
 * **认不出的块级容器不会被忽略，而是把里面所有内容压成一个块**——这是最致命的一条。
 *
 * 2026-07-29 在真实文章编辑器里派发 paste 事件逐个标签实测出来的规则：
 *
 *   ✅ 块级保留：h1 → 大标题(longform-header-one) · h2 → 小标题(longform-header-two)
 *              p → 正文段落 · blockquote → 引用块 · ul/ol + li → 列表（li 里包 p 也认）
 *   ✅ 行内保留：strong/b（加粗）· em/i（斜体）· del/s（删除线）· a[href]（链接）
 *   ⬇️ 降级：h3 及以下 → 普通段落（X 只有两级标题，白丢一层，不如就近提升）
 *   ❌ 剥成纯文本：code/pre（代码）· mark（高亮）· u（下划线）· sup/sub
 *   ❌ 直接丢弃：hr（分隔线粘不进去，只能在编辑器里走「插入」菜单）· <p><br></p> 空段落
 *   ❌ 图片：外链 <img> 粘不进去，X 把它替换成一个孤零零的 📷 字符（连 alt 都不留），
 *      没有公众号那种「粘贴自动转存外链图」的机制——只能在编辑器里手动上传
 *   ☠️ **section / div 外壳会把整段结构压塌**：公众号那份满是 <section style> 的 HTML
 *      粘过去会变成「一个巨大的段落，内部标题/引用/段落全靠软换行 \n 挤在一起」，
 *      这就是「公众号那套直接粘到 X 上一坨」的根因。所以本渲染器的顶层必须是裸标签。
 *   ❌ 内联 style 一律被剥（颜色/字号/行距全没了）。唯一的例外是 font-weight:bold|700
 *      会被认成加粗——但我们直接用 <strong>，不依赖这条。
 *   ❌ text/plain 里的 Markdown 符号**完全不会被解析**（`## x`、`**x**` 原样显示成字面量），
 *      所以纯文本兜底通道必须是「已经排好版的纯文本」，绝不能留 md 记号。
 *
 * 由此推出的设计：
 * 1. **风格对齐只能对齐结构，对不齐视觉**。X 不给内联样式，主题色/字号/行距一概带不过去。
 *    能对齐的是公众号那份的「骨架」：一段 1~2 句（复用 reflowProse）、小标题分节、
 *    加粗强调、引用块——观感上跟公众号预览是同一个节奏。
 * 2. **标题就近提升**：稿件里 `##` 是章节小标题，映射到 X 的**大标题**（h1）最醒目；
 *    `###` 及以下并到 X 的小标题（h2）。这样两级标题都用上，没有一层被降级成正文。
 * 3. **图片留提示行**：原位换成「📷 配图N：图注」，复制完在 UI 里告诉用户要手动传几张。
 */
import { marked } from "marked";
import { useCjkEmphasis } from "./marked-cjk";
import { reflowProse, stripReferences } from "./format";

marked.use({ gfm: true, breaks: true });
// 中文强调补丁：X 是保留加粗的，没有它紧邻中文的 **加粗** 会漏成字面量（见 lib/marked-cjk.ts）
useCjkEmphasis();

export interface TwitterArticleOptions {
  /** 图片粘不进 X，是否在原位留一行「📷 配图N：图注」提示，方便对照手动上传 */
  imageHints: boolean;
  /**
   * 是否把长段落按句末标点重排成「每段 1~2 句」（复用公众号预览那套 reflowProse）。
   * X 的信息流读者比公众号更没耐心，长段落是劝退主因，默认开。
   */
  reflow: boolean;
}

export const TWITTER_ARTICLE_DEFAULTS: TwitterArticleOptions = {
  imageHints: true,
  reflow: true,
};

export interface TwitterArticleResult {
  /** 写进剪贴板 text/html 的裸语义化 HTML（X 文章编辑器主通道） */
  html: string;
  /** 写进剪贴板 text/plain 的排版纯文本（兜底通道，不含任何 markdown 记号） */
  plain: string;
  /** 大标题（h1）+ 小标题（h2）总数，给 UI 反馈用 */
  headingCount: number;
  /** 被换成提示行的图片数量（提醒用户去 X 端手动上传这么多张） */
  imageCount: number;
  /** 正文段落块数，给 UI 反馈「切成了多少段」 */
  paraCount: number;
}

/** 把元素替换成它的子节点（脱掉标签、保留文字） */
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
 * 核心：把 marked 产出的通用 HTML 收敛到 X Articles 的 Draft.js blockRenderMap。
 * 凡是它认不出的块级容器，一律脱掉——留着就会把内部结构压塌成一个大段落。
 */
function toTwitterSchema(
  doc: Document,
  opts: TwitterArticleOptions,
): { headingCount: number; imageCount: number } {
  const body = doc.body;
  let imageCount = 0;

  // 1. 图片：粘不进去（X 只会留一个 📷 字符），按需换成提示行，否则整块删掉
  body.querySelectorAll("img").forEach((img) => {
    imageCount += 1;
    const caption = img.getAttribute("alt")?.trim() || "";
    const holder = img.closest("figure, p") ?? img;
    if (opts.imageHints) {
      const hint = doc.createElement("p");
      hint.textContent = `📷 配图${imageCount}${caption ? `：${caption}` : ""}`;
      holder.replaceWith(hint);
    } else {
      holder.remove();
    }
  });
  // figcaption 若还残留（figure 没被上面吃掉的情况），并进正文段落
  body.querySelectorAll("figcaption").forEach((el) => rename(doc, el, "p"));

  // 2. 标题：h2 提升为 h1（X 大标题），h3 及以下并到 h2（X 小标题）。
  //    顺序要紧——先把 h3+ 标记出来再动 h2，否则刚提上去的会被二次搬运。
  const demoted = [...body.querySelectorAll("h3, h4, h5, h6")];
  body.querySelectorAll("h2").forEach((el) => rename(doc, el, "h1"));
  demoted.forEach((el) => rename(doc, el, "h2"));

  // 3. 代码块 → 普通段落（保留代码文字本身；X 没有代码块块型）
  body.querySelectorAll("pre").forEach((pre) => {
    const p = doc.createElement("p");
    p.textContent = pre.textContent ?? "";
    pre.replaceWith(p);
  });

  // 4. 白名单外的行内标签：脱标签保文字（code/mark/u/sup/sub/span…）
  //    a 不在此列——链接是 X 认的，要留着
  body
    .querySelectorAll("code, mark, u, sub, sup, span, small, ins, abbr, cite, kbd, samp")
    .forEach((el) => unwrap(el));

  // 5. 分隔线 → X 直接丢弃 <hr>，换成一行居中符号才留得住
  body.querySelectorAll("hr").forEach((hr) => {
    const p = doc.createElement("p");
    p.textContent = "· · ·";
    hr.replaceWith(p);
  });

  // 6. 表格 → 拍平成「单元格 ｜ 单元格」的段落（X 文章没有表格块）
  body.querySelectorAll("table").forEach((table) => {
    const frag = doc.createDocumentFragment();
    table.querySelectorAll("tr").forEach((tr) => {
      const cells = [...tr.querySelectorAll("th, td")].map((c) => (c.textContent ?? "").trim());
      if (!cells.some(Boolean)) return;
      const p = doc.createElement("p");
      p.textContent = cells.join(" ｜ ");
      frag.appendChild(p);
    });
    table.replaceWith(frag);
  });

  // 7. 任务列表的 checkbox（GFM 产物）：换成符号，input 标签 X 不认
  body.querySelectorAll('input[type="checkbox"]').forEach((box) => {
    const done = box.hasAttribute("checked");
    box.replaceWith(doc.createTextNode(done ? "✅ " : "⬜️ "));
  });

  // 8. 脱掉 Draft.js 认不出的块级容器（section/div/article/main/aside/header/footer）。
  //    这一步是本渲染器的命门：留一个 <section> 就会把它内部所有块压成一个大段落。
  //    从里往外脱，避免嵌套容器漏网。
  for (let i = 0; i < 8; i++) {
    const wrappers = body.querySelectorAll(
      "section, div, article, main, aside, header, footer, nav, details, summary",
    );
    if (!wrappers.length) break;
    wrappers.forEach((el) => unwrap(el));
  }

  // 9. 清掉所有属性，只留 <a href>（X 会保留链接，其余属性一概是噪音）
  body.querySelectorAll("*").forEach((el) => {
    const keepHref = el.tagName === "A" ? el.getAttribute("href") : null;
    [...el.attributes].forEach((attr) => el.removeAttribute(attr.name));
    if (keepHref) el.setAttribute("href", keepHref);
  });

  // 10. 扫掉空段落（上面几步会留下空壳；X 本来也会丢弃它们，主动清干净免得留空块）
  body.querySelectorAll("p, h1, h2, blockquote, li").forEach((el) => {
    if (!(el.textContent ?? "").trim()) el.remove();
  });

  const headingCount = body.querySelectorAll("h1, h2").length;
  return { headingCount, imageCount };
}

/**
 * 纯文本兜底版：X 的 text/plain 通道完全不解析 markdown，所以这里输出的必须是
 * 「已经排好版、不含任何 md 记号」的文本。段间空行在纯文本通道是保留的（实测），
 * 靠它撑出 X 信息流该有的呼吸感。
 */
function toTwitterPlain(doc: Document): string {
  const out: string[] = [];

  doc.body.childNodes.forEach((node) => {
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const text = (el.textContent ?? "").trim();
    if (!text) return;

    switch (tag) {
      case "h1":
      case "h2":
        out.push(text);
        break;
      case "blockquote":
        out.push(`「${text}」`);
        break;
      case "ul":
        el.querySelectorAll(":scope > li").forEach((li) => {
          out.push(`· ${(li.textContent ?? "").trim()}`);
        });
        break;
      case "ol":
        [...el.querySelectorAll(":scope > li")].forEach((li, i) => {
          out.push(`${i + 1}. ${(li.textContent ?? "").trim()}`);
        });
        break;
      default:
        out.push(text);
    }
  });

  return out.join("\n\n");
}

/**
 * Markdown → 推特长篇（X Articles）。仅浏览器端可用（依赖 DOMParser）。
 * 调用方传原始稿件正文即可，参考资料剔除与 1~2 句重排都在这里面做，
 * 保证跟右侧公众号预览是同一个节奏。
 */
export function renderTwitterArticle(
  md: string,
  opts: TwitterArticleOptions = TWITTER_ARTICLE_DEFAULTS,
): TwitterArticleResult {
  const cleaned = stripReferences(md ?? "");
  const source = opts.reflow ? reflowProse(cleaned) : cleaned;

  const raw = marked.parse(source, { async: false }) as string;
  const doc = new DOMParser().parseFromString(`<body>${raw}</body>`, "text/html");

  const { headingCount, imageCount } = toTwitterSchema(doc, opts);

  return {
    html: doc.body.innerHTML,
    plain: toTwitterPlain(doc),
    headingCount,
    imageCount,
    paraCount: doc.body.querySelectorAll("p").length,
  };
}
