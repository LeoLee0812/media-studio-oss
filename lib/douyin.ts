/**
 * 抖音长文（创作者中心「发布文章」）导出工具：Markdown → 结构化纯文本。
 *
 * 【角色定位】这份纯文本是抖音正文复制的 **text/plain 兜底通道**，不是主通道。
 * 实测（用户确认）抖音正文编辑器和公众号一样，粘贴富文本时会把外链 <img> 自动转存过去——
 * 所以正文主通道直接复用公众号那份 WeMark 富文本 HTML（text/html），图片随粘贴带过来。
 * 本函数产出的纯文本只在「目标只吃 text/plain」时兜底，此时图片带不过去，故用占位提示。
 *
 * 转换规则（兜底纯文本）：
 *   ✅ 段落换行、小标题（降为纯文本行）、有序/无序列表、引用、emoji
 *   ❌ 加粗/斜体/行内代码 → 脱标记保文字（纯文本无行内强调）
 *   ❌ 超链接 → 只留链接文字
 *   ❌ 图片 → 原位留「【配图N：图注】」占位（纯文本通道带不了图，提醒手动补）
 *
 * 抖音的字段约束（前端做计数校验用）：
 *   标题 ≤30 字、摘要 ≤30 字（按 Unicode 码点数，一个汉字/字母/标点/emoji 各算 1）、
 *   正文 300–8000 字、配图 ≤30 张。计数一律用 Array.from(str).length（码点），
 *   而非 str.length（后者会把 emoji/代理对算成 2，与抖音计数器口径不符）。
 */

/** 抖音字段上限（字，按码点算） */
export const DOUYIN_TITLE_MAX = 30;
export const DOUYIN_SUMMARY_MAX = 30;
/** 正文字数区间（抖音长图文要求正文 ≥300 字才走长文分发，上限 8000） */
export const DOUYIN_BODY_MIN = 300;
export const DOUYIN_BODY_MAX = 8000;
/** 配图张数上限 */
export const DOUYIN_IMAGE_MAX = 30;

export interface DouyinBodyResult {
  /** 写进剪贴板的结构化纯文本正文 */
  text: string;
  /** 正文字数（码点数），给 UI 做 300/8000 区间校验 */
  charCount: number;
  /** 被替换成占位提示的图片数量（提醒用户去抖音端手动上传这么多张） */
  imageCount: number;
}

/** 剥掉一行里的行内 markdown 标记，保留可读文字（抖音正文不吃行内富样式） */
function stripInline(line: string): string {
  return line
    // 图片已在行级处理，这里兜底把残留的行内图也换成占位（无编号，极少见）
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    // 链接 [文字](url) → 文字
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // 加粗 **x** / __x__ → x
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    // 斜体 *x* / _x_ → x（避免误伤单个 * 分隔）
    .replace(/(?<![*_])(\*|_)(?!\s)(.+?)(?<!\s)\1(?![*_])/g, "$2")
    // 行内代码 `x` → x
    .replace(/`([^`]+)`/g, "$1")
    .trimEnd();
}

/**
 * Markdown 正文 → 抖音「结构化纯文本」。纯函数，前后端通用（不依赖 DOM）。
 * 图片按出现顺序编号，替换成「【配图N：图注】」占位行。
 */
export function renderDouyinBody(md: string): DouyinBodyResult {
  const src = (md ?? "").replace(/\r\n/g, "\n");
  const out: string[] = [];
  let imageCount = 0;

  for (const rawLine of src.split("\n")) {
    const line = rawLine.trimEnd();
    const t = line.trim();

    // 整行图片 ![alt](url) → 占位提示（可能一行多张，逐个替换）
    if (/!\[[^\]]*\]\([^)]*\)/.test(t) && t.replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim() === "") {
      t.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt) => {
        imageCount += 1;
        const caption = String(alt ?? "").trim();
        out.push(`【配图${imageCount}${caption ? `：${caption}` : ""}】`);
        return "";
      });
      continue;
    }

    // 分隔线 → 一行居中符号（抖音没有 hr）
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      out.push("· · ·");
      continue;
    }

    // 小标题 #{1,6} → 纯文本行（抖音正文靠段落 + 空行体现层级，不留 # 标记）
    const heading = t.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      out.push(stripInline(heading[1]));
      continue;
    }

    // 引用 > → 脱掉引用符保文字
    const quote = t.match(/^>\s?(.*)$/);
    if (quote) {
      out.push(stripInline(quote[1]));
      continue;
    }

    // 无序列表 -/*/+ → 「· 」
    const ul = t.match(/^[-*+]\s+(.*)$/);
    if (ul) {
      out.push(`· ${stripInline(ul[1])}`);
      continue;
    }

    // 有序列表「1. 」→ 原样保留序号
    const ol = t.match(/^(\d+)\.\s+(.*)$/);
    if (ol) {
      out.push(`${ol[1]}. ${stripInline(ol[2])}`);
      continue;
    }

    // 空行原样保留（后面统一收敛连续空行）
    if (!t) {
      out.push("");
      continue;
    }

    out.push(stripInline(line));
  }

  // 收敛连续空行到最多一个空行；去掉首尾空行
  const text = out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    text,
    charCount: Array.from(text).length,
    imageCount,
  };
}
