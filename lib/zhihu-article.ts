/**
 * 知乎专栏渲染器：Markdown → 知乎编辑器吃得下的「裸语义化 HTML」。
 * （注意与 `lib/zhihu.ts` 区分：那份是知乎开放平台**采集**客户端，跟发文无关。）
 *
 * 为什么又是独立一套：
 * - 公众号那份满是 `<section style>` 的 HTML 不能直接用——富文本编辑器对认不出的块级容器
 *   要么剥成纯文本、要么把内部结构压塌成一个大段落（X Articles 就是后者，实测记录见
 *   `lib/twitter-article.ts`）。顶层必须是裸标签。
 * - 但知乎比 X 宽容得多，两条关键差异决定了不能直接复用推特那份：
 *   ① **图片能带过去**：知乎粘贴外链 `<img>` 会自动抓取转存（与公众号同机制），
 *      所以这里保留 `<img>`，不像推特那样换成「📷 配图N」提示行；
 *   ② **代码块 / 分隔线 / 表格都有对应块型**，保留 `<pre><code>` / `<hr>` / `<table>`，
 *      不用像推特那样拍平成段落。
 * - 内联样式一律被剥（主题色、字号、行距带不过去），所以能对齐的只有**结构与节奏**：
 *   复用 `reflowProse` 的「每段 1~2 句」+ 小标题分节 + 加粗强调 + 引用块，
 *   读起来跟右侧公众号预览是同一个呼吸感。
 *
 * 标题映射：稿件里的 `##` 是章节小标题 → 知乎一级标题 `<h2>`；`###` 及以下 → `<h3>`。
 * （知乎编辑器只有两级标题，`<h1>` 会被降级，索性从 h2 起用。）
 *
 * 纯前端、不碰 AI 也不碰接口：点了即刻写剪贴板，跟「复制到公众号」一样是确定性转换。
 */
import { marked } from "marked";
import { useCjkEmphasis } from "./marked-cjk";
import { reflowProse, stripReferences } from "./format";

marked.use({ gfm: true, breaks: true });
// 中文强调补丁：知乎保留加粗，没有它紧邻中文的 **加粗** 会漏成字面量（见 lib/marked-cjk.ts）
useCjkEmphasis();

export interface ZhihuArticleOptions {
  /** 是否把长段落按句末标点重排成「每段 1~2 句」（复用公众号预览那套 reflowProse） */
  reflow: boolean;
}

export const ZHIHU_ARTICLE_DEFAULTS: ZhihuArticleOptions = { reflow: true };

export interface ZhihuArticleResult {
  /** 写进剪贴板 text/html 的裸语义化 HTML（知乎编辑器主通道） */
  html: string;
  /** 写进剪贴板 text/plain 的排版纯文本（兜底通道，不含任何 markdown 记号） */
  plain: string;
  /** 标题（h2 + h3）总数，给 UI 反馈用 */
  headingCount: number;
  /** 随 HTML 带过去的图片数量（知乎自动转存，个别失败的用本地原图手动替换） */
  imageCount: number;
  /** 正文段落块数 */
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

/** 收敛到知乎认的标签集合：块级只留裸标签，属性只留 a[href] 与 img[src/alt] */
function toZhihuSchema(doc: Document): { headingCount: number; imageCount: number } {
  const body = doc.body;

  // 1. 标题：h1/h2 → h2（知乎一级标题），h3 及以下 → h3（二级标题）。
  //    先把 h3+ 记下来再动 h1/h2，否则刚搬过去的会被二次搬运。
  const demoted = [...body.querySelectorAll("h3, h4, h5, h6")];
  body.querySelectorAll("h1, h2").forEach((el) => rename(doc, el, "h2"));
  demoted.forEach((el) => rename(doc, el, "h3"));

  // 2. 图注：figcaption 换成独立段落（知乎没有 figure/figcaption 块型）。
  //    要在脱容器之前做，免得图注文字被并进图片所在的段落里。
  body.querySelectorAll("figcaption").forEach((el) => rename(doc, el, "p"));

  // 3. 白名单外的行内标签脱标签保文字；code 例外——知乎有行内代码
  body
    .querySelectorAll("mark, u, sub, sup, span, small, ins, abbr, cite, kbd, samp")
    .forEach((el) => unwrap(el));

  // 4. 任务列表的 checkbox（GFM 产物）：换成符号，input 标签编辑器不认
  body.querySelectorAll('input[type="checkbox"]').forEach((box) => {
    const done = box.hasAttribute("checked");
    box.replaceWith(doc.createTextNode(done ? "✅ " : "⬜️ "));
  });

  // 5. 脱掉编辑器认不出的块级容器（figure/section/div…），从里往外脱避免嵌套漏网。
  //    留一个容器就有把内部结构压塌成一整段的风险，这是富文本编辑器的通病。
  for (let i = 0; i < 8; i++) {
    const wrappers = body.querySelectorAll(
      "figure, section, div, article, main, aside, header, footer, nav, details, summary",
    );
    if (!wrappers.length) break;
    wrappers.forEach((el) => unwrap(el));
  }

  // 6. 图片独立成段：脱掉 figure 后 img 可能裸在 body 下，包一层 p 保证它是独立块
  const imgs = [...body.querySelectorAll("img")];
  imgs.forEach((img) => {
    if (img.parentElement === body) {
      const p = doc.createElement("p");
      img.replaceWith(p);
      p.appendChild(img);
    }
  });

  // 7. 清属性：只留 a[href] 与 img[src/alt]，其余（内联样式、class、data-*）都是噪音
  body.querySelectorAll("*").forEach((el) => {
    const tag = el.tagName;
    const href = tag === "A" ? el.getAttribute("href") : null;
    const src = tag === "IMG" ? el.getAttribute("src") : null;
    const alt = tag === "IMG" ? el.getAttribute("alt") : null;
    [...el.attributes].forEach((attr) => el.removeAttribute(attr.name));
    if (href) el.setAttribute("href", href);
    if (src) el.setAttribute("src", src);
    if (alt) el.setAttribute("alt", alt);
  });

  // 8. 扫掉空块（前几步会留下空壳），但别碰只装图片的段落
  body.querySelectorAll("p, h2, h3, blockquote, li").forEach((el) => {
    if (el.querySelector("img")) return;
    if (!(el.textContent ?? "").trim()) el.remove();
  });

  return {
    headingCount: body.querySelectorAll("h2, h3").length,
    imageCount: imgs.length,
  };
}

/** 纯文本兜底版：text/plain 通道不解析 markdown，输出的是已经排好版的文本 */
function toZhihuPlain(doc: Document): string {
  const out: string[] = [];

  doc.body.childNodes.forEach((node) => {
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    if (tag === "hr") {
      out.push("· · ·");
      return;
    }
    if (tag === "ul") {
      el.querySelectorAll(":scope > li").forEach((li) => {
        const t = (li.textContent ?? "").trim();
        if (t) out.push(`· ${t}`);
      });
      return;
    }
    if (tag === "ol") {
      [...el.querySelectorAll(":scope > li")].forEach((li, i) => {
        const t = (li.textContent ?? "").trim();
        if (t) out.push(`${i + 1}. ${t}`);
      });
      return;
    }
    if (tag === "table") {
      el.querySelectorAll("tr").forEach((tr) => {
        const cells = [...tr.querySelectorAll("th, td")].map((c) => (c.textContent ?? "").trim());
        if (cells.some(Boolean)) out.push(cells.join(" ｜ "));
      });
      return;
    }

    const text = (el.textContent ?? "").trim();
    if (!text) {
      // 只装图片的段落在纯文本通道留一行占位，方便对照
      if (el.querySelector("img")) out.push("（配图）");
      return;
    }
    out.push(tag === "blockquote" ? `「${text}」` : text);
  });

  return out.join("\n\n");
}

/**
 * Markdown → 知乎专栏。仅浏览器端可用（依赖 DOMParser）。
 * 调用方传原始稿件正文即可，参考资料剔除与 1~2 句重排都在这里面做，
 * 保证跟右侧公众号预览是同一个节奏。
 */
export function renderZhihuArticle(
  md: string,
  opts: ZhihuArticleOptions = ZHIHU_ARTICLE_DEFAULTS,
): ZhihuArticleResult {
  const cleaned = stripReferences(md ?? "");
  const source = opts.reflow ? reflowProse(cleaned) : cleaned;

  const raw = marked.parse(source, { async: false }) as string;
  const doc = new DOMParser().parseFromString(`<body>${raw}</body>`, "text/html");

  const { headingCount, imageCount } = toZhihuSchema(doc);

  return {
    html: doc.body.innerHTML,
    plain: toZhihuPlain(doc),
    headingCount,
    imageCount,
    paraCount: doc.body.querySelectorAll("p").length,
  };
}
