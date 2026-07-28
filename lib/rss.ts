// ===== 轻量 RSS / Atom 解析器 =====
// 零依赖：正则 + 字符串解析，只取写作素材需要的字段（标题/链接/时间/纯文本摘要）。
// 支持 RSS 2.0 的 <item> 与 Atom 的 <entry>，容忍命名空间与属性差异。
// 不追求完备的 XML 解析——feed 内容最终只当「选题发现层」，摘要截 500 字。

export interface RssItem {
  title: string;
  link: string;
  publishedAt: string | null; // ISO 字符串；解析不出则 null
  summary: string; // 纯文本摘要，≤500 字
}

export interface ParsedFeed {
  title: string | null; // 频道标题
  items: RssItem[];
}

// 采集侧自报 UA（约定：绝不伪装浏览器，可用 SYNC_UA 环境变量覆盖）
export const RSS_UA = process.env.SYNC_UA || "media-studio-sync/1.0";

// 常见命名实体表（feed 摘要够用；未覆盖的原样保留）
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  copy: "©",
  reg: "®",
  trade: "™",
  middot: "·",
  laquo: "«",
  raquo: "»",
};

// 码点转字符，非法码点原样吞掉
function safeFromCodePoint(cp: number): string {
  try {
    return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
  } catch {
    return "";
  }
}

// HTML 实体解码（单次解码：&amp;lt; → &lt;，符合规范）
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeFromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (m: string, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

// 去掉 CDATA 包装，保留内容
function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

// 把（可能被 XML 转义过的）HTML 片段转成纯文本：
// 解 CDATA → 解实体（把 &lt;p&gt; 还原成 <p>）→ 剥标签 → 再解一次实体（正文里的 &amp; 等）→ 收拢空白 → 截断
export function toPlainText(html: string, maxLen = 500): string {
  const text = decodeEntities(
    decodeEntities(stripCdata(html))
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLen ? text.slice(0, maxLen - 1) + "…" : text;
}

// 取块内首个匹配标签的内层文本（按传入顺序找，支持带命名空间前缀的标签名如 content:encoded）
function tagText(block: string, ...tags: string[]): string | null {
  for (const t of tags) {
    const re = new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${t}>`, "i");
    const m = block.match(re);
    if (m) return m[1];
  }
  return null;
}

// 提取条目链接：兼容 Atom 的 <link href="..."/>（优先 rel="alternate"）与 RSS 2.0 的 <link>url</link>
function extractLink(block: string): string | null {
  const linkTags = block.match(/<link\b[^>]*>/gi) ?? [];
  let fallback: string | null = null;
  for (const lt of linkTags) {
    const href = lt.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const rel = lt.match(/rel=["']([^"']+)["']/i)?.[1];
    if (!rel || rel === "alternate") return decodeEntities(href.trim());
    if (!fallback) fallback = decodeEntities(href.trim());
  }
  if (fallback) return fallback;
  const m = block.match(/<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i);
  if (m) {
    const v = decodeEntities(stripCdata(m[1])).trim();
    if (v) return v;
  }
  return null;
}

// 发布时间解析：RSS pubDate（RFC822）/ Atom published|updated / dc:date，统一转 ISO
function extractPublishedAt(block: string): string | null {
  const raw = tagText(block, "pubDate", "published", "updated", "dc:date");
  if (!raw) return null;
  const ts = new Date(stripCdata(raw).trim()).getTime();
  return Number.isFinite(ts) && ts > 0 ? new Date(ts).toISOString() : null;
}

// 解析 feed 全文：自动识别 RSS 2.0（item）或 Atom（entry）
export function parseFeed(xml: string): ParsedFeed {
  const tag = /<item[\s>]/i.test(xml) ? "item" : "entry";
  const blockRe = new RegExp(`<${tag}[\\s>][\\s\\S]*?<\\/${tag}>`, "gi");
  const blocks = xml.match(blockRe) ?? [];

  // 频道标题：取第一个条目块之前的首个 <title>
  const first = blocks[0];
  const headEnd = first ? xml.indexOf(first) : xml.length;
  const head = xml.slice(0, Math.max(0, headEnd));
  const feedTitleRaw = tagText(head, "title");
  const feedTitle = feedTitleRaw ? toPlainText(feedTitleRaw, 200) || null : null;

  const items: RssItem[] = [];
  for (const block of blocks) {
    const titleRaw = tagText(block, "title");
    const title = titleRaw ? toPlainText(titleRaw, 300) : "";
    const link = extractLink(block);
    if (!title || !link) continue; // 没标题或没链接的条目无法当素材，跳过
    const summaryRaw = tagText(block, "description", "summary", "content:encoded", "content");
    items.push({
      title,
      link,
      publishedAt: extractPublishedAt(block),
      summary: summaryRaw ? toPlainText(summaryRaw, 500) : "",
    });
  }
  return { title: feedTitle, items };
}

// 抓取并解析一个 feed（20s 超时；调用方负责按 feed 隔离错误）
export async function fetchFeed(url: string): Promise<ParsedFeed> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": RSS_UA,
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    },
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`RSS 请求失败 ${res.status} ${url}`);
  const xml = await res.text();
  return parseFeed(xml);
}
