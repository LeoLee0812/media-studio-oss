import { getCloudflareContext } from "@opennextjs/cloudflare";

// ===== Cloudflare D1 数据层 =====
//
// 全站唯一的数据库入口。原先是 Supabase Postgres（postgres.js 直连 pooler），
// 迁到 Cloudflare 后换成 D1——Cloudflare 自家的 SQLite：
//   · 不需要 Hyperdrive，也不受 Workers 连不上外部 Postgres 的 TLS 限制
//   · 走 HTTP 绑定，没有连接池、没有半死 socket，原先那套「连接自愈」的复杂度直接消失
//   · 免费额度足够单用户长期跑
//
// 这里实现的是一层**标签模板 shim**，把 D1 的 prepare/bind 包成 postgres.js 那种写法：
//
//   await sql`select * from ms_drafts where id = ${id}`      → 参数自动占位，防注入
//   await sql`insert into ms_topics ${sql(obj)} returning *`  → 自动展开成 (列) values (?)
//   await sql`update ms_topics set ${sql(patch)} where ...`   → 自动展开成 col = ?, col = ?
//   await sql`insert into ms_materials ${sql(rows, ...cols)}` → 多行批量插入
//   sql`where ${cond}` 这类**片段可以互相嵌套**，拼 where 条件时照旧
//
// 为什么不直接写 d1.prepare(...)：查询散落在 queries / ingest / cleanup / translate 四处，
// 保住这套写法能让这些文件只改 SQL 方言，不用把每条语句拆成手工拼占位符。

// ---- 片段与特殊值 ----

/** 一段可组合的 SQL 片段。await 它就会执行（是个 thenable）。 */
class Frag<T = Record<string, unknown>> {
  constructor(
    readonly strings: readonly string[],
    readonly values: readonly unknown[],
  ) {}

  then<R1 = T[], R2 = never>(
    onOk?: ((rows: T[]) => R1 | PromiseLike<R1>) | null,
    onErr?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return run<T>(this).then(onOk, onErr);
  }
}

/** sql.json(v)：明确按 JSON 文本存。D1 没有 jsonb，所有结构化字段都是 TEXT + json_extract 读。 */
class JsonVal {
  constructor(readonly value: unknown) {}
}

/** sql(obj) / sql(rows, ...cols)：插入或更新的列集合，展开形态由它前面那截 SQL 决定。 */
class Cols {
  constructor(
    readonly rows: Record<string, unknown>[],
    readonly cols: string[],
  ) {}
}

/** sql.list([...])：展开成 (?, ?, ?)，给 in (...) 用。空数组会展开成 (null)，天然匹配不到任何行。 */
class ListVal {
  constructor(readonly items: unknown[]) {}
}

const IDENT = /^[a-z_][a-z0-9_]*$/i;
function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`非法列名：${name}`);
  return `"${name}"`;
}

// ---- 值绑定 ----
// D1 只接受 null / number / string / ArrayBuffer / boolean。
// 项目里的数组（tags、material_ids）和对象（raw、meta、research、value）统一转 JSON 文本，
// 与建表 SQL 里那几列的 TEXT 类型对齐。
function bindValue(v: unknown): null | number | string {
  if (v === null || v === undefined) return null;
  if (v instanceof JsonVal) return v.value === null || v.value === undefined ? null : JSON.stringify(v.value);
  if (typeof v === "string" || typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
}

// ---- 编译：片段树 → 一条 SQL + 参数数组 ----
interface Compiled {
  text: string;
  params: (null | number | string)[];
}

function compile(frag: Frag<never>): Compiled {
  const out: Compiled = { text: "", params: [] };
  walk(frag, out);
  return out;
}

function walk(frag: Frag<never>, out: Compiled): void {
  for (let i = 0; i < frag.strings.length; i++) {
    out.text += frag.strings[i];
    if (i >= frag.values.length) continue;
    const v = frag.values[i];

    if (v instanceof Frag) {
      walk(v as Frag<never>, out);
    } else if (v instanceof Cols) {
      expandCols(v, out);
    } else if (v instanceof ListVal) {
      if (v.items.length === 0) {
        out.text += "(null)";
      } else {
        out.text += `(${v.items.map(() => "?").join(", ")})`;
        for (const item of v.items) out.params.push(bindValue(item));
      }
    } else {
      out.text += "?";
      out.params.push(bindValue(v));
    }
  }
}

// sql(obj) 到底展开成 insert 的 (列) values (…) 还是 update 的 col = ?，
// 看它前面那截 SQL 是不是以 set 结尾——和 postgres.js 的判定思路一致。
function expandCols(c: Cols, out: Compiled): void {
  const isSet = /\bset\s*$/i.test(out.text);
  if (isSet) {
    const row = c.rows[0] ?? {};
    const cols = c.cols.length ? c.cols : Object.keys(row);
    if (cols.length === 0) throw new Error("update ... set 的更新字段为空");
    out.text += cols.map((k) => `${ident(k)} = ?`).join(", ");
    for (const k of cols) out.params.push(bindValue(row[k]));
    return;
  }
  const cols = c.cols.length ? c.cols : Object.keys(c.rows[0] ?? {});
  if (cols.length === 0) throw new Error("insert 的列集合为空");
  const tuple = `(${cols.map(() => "?").join(", ")})`;
  out.text += `(${cols.map(ident).join(", ")}) values ${c.rows.map(() => tuple).join(", ")}`;
  for (const row of c.rows) for (const k of cols) out.params.push(bindValue(row[k]));
}

// ---- 执行 ----

interface D1Like {
  prepare(query: string): {
    bind(...values: unknown[]): { all<T>(): Promise<{ results?: T[] }> };
    all<T>(): Promise<{ results?: T[] }>;
  };
}

const BINDING = "DB";

function d1(): D1Like {
  let env: Record<string, unknown> | undefined;
  try {
    env = getCloudflareContext().env as unknown as Record<string, unknown>;
  } catch {
    env = undefined;
  }
  const db = env?.[BINDING] as D1Like | undefined;
  if (!db || typeof db.prepare !== "function") {
    throw new Error(
      `拿不到 D1 绑定（${BINDING}）：本地开发请用 npm run preview，线上请确认 wrangler.jsonc 里的 d1_databases 配置`,
    );
  }
  return db;
}

async function run<T>(frag: Frag<T>): Promise<T[]> {
  const { text, params } = compile(frag as unknown as Frag<never>);
  const stmt = d1().prepare(text);
  const res = params.length ? await stmt.bind(...params).all<T>() : await stmt.all<T>();
  return res.results ?? [];
}

// ---- 对外的 sql ----

interface SqlFn {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Frag<T>;
  (obj: Record<string, unknown>): Cols;
  (rows: Record<string, unknown>[], ...cols: string[]): Cols;
  /** 按 JSON 文本存（D1 没有 jsonb） */
  json(v: unknown): JsonVal;
  /** 展开成 (?, ?, ?)，给 in (...) 用 */
  list(items: unknown[]): ListVal;
}

export const sql: SqlFn = Object.assign(
  (first: TemplateStringsArray | Record<string, unknown> | Record<string, unknown>[], ...rest: unknown[]) => {
    if (Array.isArray(first) && "raw" in first) {
      return new Frag(first as unknown as string[], rest);
    }
    if (Array.isArray(first)) {
      return new Cols(first as Record<string, unknown>[], rest as string[]);
    }
    return new Cols([first as Record<string, unknown>], []);
  },
  {
    json: (v: unknown) => new JsonVal(v),
    list: (items: unknown[]) => new ListVal(items),
  },
) as SqlFn;

// ---- 时间：全部用 ISO-8601 字符串，比较交给字符串大小 ----
// SQLite 的 datetime('now') 给的是 "YYYY-MM-DD HH:MM:SS"，和我们存的 ISO（带 T 和 Z）
// 直接比大小会错位。所以时间的加减一律在 JS 里算好再绑进去，SQL 里只做字符串比较。
export function nowIso(): string {
  return new Date().toISOString();
}

export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

export function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

// ---- 行解码 ----
// D1 把 JSON 列原样当 TEXT 返回，这里统一还原成对象/数组，好让上层拿到的行
// 与 lib/types.ts 的定义一致（前端代码零改动）。
export function parseJsonCol<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v !== "string") return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}
