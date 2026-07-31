// 本地笔记批量导入：把一个本地文件夹（Obsidian vault / 任意 Markdown 目录）里的笔记
// 解析成素材条目。纯函数，无 Node/浏览器 API 依赖，客户端解析 + 服务端二次校验共用。
//
// 隐私边界：文件内容由浏览器本地读取，只 POST 到你自己这一份部署的 /api/materials/bulk，
// 不经任何第三方；公开演示站是 READ_ONLY，写接口一律 403，所以线上永远收不到这些内容。

/** 收哪些扩展名：只收纯文本笔记，图片/PDF/HTML 附件一律跳过 */
const TEXT_EXTS = [".md", ".markdown", ".mdx", ".txt"];

/** 跳过的目录名：Obsidian 内部配置、版本控制、依赖、系统垃圾 */
const SKIP_DIRS = new Set([
  ".obsidian",
  ".trash",
  ".git",
  ".vscode",
  ".idea",
  "node_modules",
  "__pycache__",
  ".DS_Store",
]);

/** 单条正文入库上限（字符）：Obsidian 里偶有几十万字的汇总笔记，截断防止一次请求过大 */
export const MAX_CONTENT_CHARS = 20_000;
/** 摘要长度（字符） */
const SUMMARY_CHARS = 140;
/** 单条标签上限 */
const MAX_TAGS = 12;
/** 单次批量请求的条数上限（服务端强校验，前端按此分批） */
export const BULK_BATCH_SIZE = 50;
/** 单次导入的总条数上限，防止误拖一个几万文件的目录 */
export const MAX_IMPORT_FILES = 2000;

/** 解析后的一条待导入素材 */
export interface ParsedNote {
  /** 相对 vault 根的路径，做去重键与溯源用，如 daily/2026-07-30.md */
  path: string;
  title: string;
  summary: string | null;
  content: string;
  tags: string[];
  /** 板块：默认取相对路径的首层目录名（根目录下的文件为 null） */
  pillar: string | null;
  /** frontmatter 里的 source/url 字段（Obsidian 剪藏笔记常带） */
  url: string | null;
  /** frontmatter 里的 date/created（ISO 字符串），解析失败为 null */
  published_at: string | null;
  /** 原始字符数，界面上给个体量感 */
  chars: number;
}

/** 该路径是否是要收的文本笔记（同时过滤隐藏文件与跳过目录） */
export function isImportablePath(path: string): boolean {
  const segs = path.split("/").filter(Boolean);
  if (segs.length === 0) return false;
  // 任一层目录命中黑名单或以 . 开头（隐藏目录）就整棵跳过
  for (const seg of segs.slice(0, -1)) {
    if (SKIP_DIRS.has(seg) || seg.startsWith(".")) return false;
  }
  const name = segs[segs.length - 1];
  if (name.startsWith(".")) return false;
  const lower = name.toLowerCase();
  return TEXT_EXTS.some((ext) => lower.endsWith(ext));
}

/** 去掉扩展名的文件名 */
function baseName(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * 极简 YAML frontmatter 解析：只认 `key: value`、缩进的 `- item` 列表、`[a, b]` 内联数组。
 * Obsidian 的 frontmatter 99% 是这三种形态；解析不了的键直接忽略，绝不抛错。
 */
export function parseFrontmatter(raw: string): {
  data: Record<string, string | string[]>;
  body: string;
} {
  if (!raw.startsWith("---")) return { data: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: raw };
  const head = raw.slice(raw.indexOf("\n") + 1, end);
  const body = raw.slice(end + 4).replace(/^\r?\n/, "");

  const data: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  for (const line of head.split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      const prev = data[listKey];
      const val = stripQuotes(item[1]);
      if (!val) continue;
      data[listKey] = Array.isArray(prev) ? [...prev, val] : [val];
      continue;
    }
    const kv = /^([A-Za-z0-9_\-一-龥]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const rest = kv[2].trim();
    if (!rest) {
      // `tags:` 后面跟缩进列表
      listKey = key;
      data[key] = [];
      continue;
    }
    listKey = null;
    if (rest.startsWith("[") && rest.endsWith("]")) {
      data[key] = rest
        .slice(1, -1)
        .split(",")
        .map((s) => stripQuotes(s))
        .filter(Boolean);
    } else {
      data[key] = stripQuotes(rest);
    }
  }
  return { data, body };
}

function stripQuotes(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).trim();
  }
  return t;
}

function firstString(v: string | string[] | undefined): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (Array.isArray(v) && v.length > 0) return String(v[0]).trim() || null;
  return null;
}

/** 正文里的 Obsidian 行内标签 `#标签`（排除 `# 标题` 这种带空格的） */
function inlineTags(body: string): string[] {
  const out: string[] = [];
  const re = /(?:^|[\s(（])#([A-Za-z0-9_一-龥][A-Za-z0-9_\-/一-龥]{0,29})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.push(m[1]);
  return out;
}

/** 摘要：剥掉代码块、标题号、链接/图片语法、引用符后取前若干字 */
function buildSummary(body: string): string | null {
  const plain = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^---[\s\S]*?---/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, "$1") // Obsidian 双链
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return null;
  return plain.length > SUMMARY_CHARS ? plain.slice(0, SUMMARY_CHARS) + "…" : plain;
}

/** frontmatter 日期 → ISO 字符串；解析不出来就 null（不猜） */
function parseDate(v: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * 把一份笔记原文解析成待导入素材。
 * 标题优先级：frontmatter.title → 正文第一个一级标题 → 文件名。
 */
export function parseNote(relPath: string, raw: string): ParsedNote {
  const { data, body } = parseFrontmatter(raw);

  const fmTitle = firstString(data.title ?? data["标题"]);
  const h1 = /^\s{0,3}#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? null;
  const title = (fmTitle || h1 || baseName(relPath)).slice(0, 200);

  const fmTags = data.tags ?? data.tag ?? data["标签"];
  const tags = Array.from(
    new Set(
      [
        ...(Array.isArray(fmTags) ? fmTags : typeof fmTags === "string" ? fmTags.split(/[,，\s]+/) : []),
        ...inlineTags(body),
      ]
        .map((t) => String(t).replace(/^#/, "").trim())
        .filter((t) => t.length > 0 && t.length <= 30),
    ),
  ).slice(0, MAX_TAGS);

  const segs = relPath.split("/").filter(Boolean);
  const pillar = segs.length > 1 ? segs[0].slice(0, 30) : null;

  const url = firstString(data.source ?? data.url ?? data["链接"]);
  const published_at = parseDate(
    firstString(data.date ?? data.created ?? data["日期"] ?? data["创建时间"]),
  );

  const content = raw.length > MAX_CONTENT_CHARS ? raw.slice(0, MAX_CONTENT_CHARS) + "\n\n…（正文已截断）" : raw;

  return {
    path: relPath,
    title,
    summary: buildSummary(body),
    content,
    tags,
    pillar,
    url: url && /^https?:\/\//i.test(url) ? url : null,
    published_at,
    chars: raw.length,
  };
}

/** 去重键：同一份 vault 里同路径的笔记只入库一次，重复导入自动跳过 */
export function noteDedupeKey(vault: string, path: string): string {
  const v = vault.trim() || "vault";
  return `local:${v}/${path}`;
}
