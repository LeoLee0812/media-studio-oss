import postgres from "postgres";
import { getCloudflareContext } from "@opennextjs/cloudflare";

// Supabase transaction pooler 连接（服务端专用）。
// 使用 ms_app 角色，RLS 只放行该角色，anon/publishable 默认全拒。
// transaction pooler 必须 prepare:false；serverless 下连接数保持较小。
const globalForDb = globalThis as unknown as {
  _msSql?: ReturnType<typeof postgres>;
};

// 本机 Postgres（localhost/127.0.0.1）默认不开 TLS，强行 ssl:require 会连不上；
// 自部署/本地开发用本机库时自动关掉，远端一律仍走 require。
function needsSsl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return !(host === "localhost" || host === "127.0.0.1" || host === "::1");
  } catch {
    return true;
  }
}

// 跑在 Cloudflare Workers 上（workerd 会把 navigator.userAgent 设成 Cloudflare-Workers）。
// 用它来切那几个「Node 有、workerd 没有」的 socket 选项。
const isWorkers =
  typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

// ===== 连接串从哪来 =====
// 线上（Workers）：Hyperdrive 绑定给的本地连接串。**必须走 Hyperdrive**——
//   Workers 直连 Supabase 时 TCP 能建、SSLRequest 也回 S，但 startTls() 一律
//   "TLS Handshake Failed"（6543/5432 都试过）。Hyperdrive 在 Cloudflare 侧替你把
//   TLS 和连接池做掉，Worker 只需连它给的本地地址，顺带还有跨区连接复用。
// 本地开发 / 其他运行时：env DATABASE_URL 直连。
function resolveUrl(): string {
  try {
    const hd = (getCloudflareContext().env as unknown as Record<string, unknown>)?.HYPERDRIVE as
      | { connectionString?: string }
      | undefined;
    if (hd?.connectionString) return hd.connectionString;
  } catch {
    // 不在 Workers 请求上下文里，落到 env
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("缺少数据库连接：线上请绑定 Hyperdrive，本地请配 DATABASE_URL");
  return url;
}

function create() {
  const url = resolveUrl();
  return postgres(url, {
    prepare: false,
    ssl: needsSsl(url) ? "require" : false,
    max: 5,
    // 空闲连接保留 2 分钟：实测挂起集中在「新建连接到 pooler」这一步（约一半概率挂死），
    // 已建立的连接一直健康，所以尽量少重连、多复用
    idle_timeout: 120,
    // 健康连接通常 1~3 秒内建好，超时就快速放弃让 postgres.js 自动换新连接重试。
    // Cloudflare Workers 跑在离用户最近的边缘节点，到数据库的距离不固定（不像单区域的
    // serverless 能与库同区），所以生产默认给到 8 秒；本地开发跨国链路更慢，放宽到 15。
    // 想自己调就配 DB_CONNECT_TIMEOUT（秒）。
    connect_timeout:
      Number(process.env.DB_CONNECT_TIMEOUT) ||
      (process.env.NODE_ENV === "production" ? 8 : 15),
    // 连接最长存活 5 分钟：serverless 实例可能被冻结/休眠，醒来后旧 socket 已死，
    // 复用它查询会无限挂起（曾导致页面挂满 300 秒函数超时）。定期换新连接兜底。
    max_lifetime: 60 * 5,
    // TCP 保活（秒）：尽早暴露对端已断开的连接，而不是等到查询时才卡死。
    // workerd 的 socket 垫片不支持 setKeepAlive，置 null 关掉（Node 环境保持 30 秒）。
    keep_alive: isWorkers ? null : 30,
    // Workers 上关掉建连后那轮 pg_type 探测：多一次往返没必要，
    // 且只影响自定义类型的自动解析，本项目全是内建类型，无感。
    ...(isWorkers ? { fetch_types: false } : {}),
  });
}

// ===== 为什么是懒加载的 Proxy 而不是模块级实例 =====
// Hyperdrive 的连接串只有在**请求上下文里**才拿得到（getCloudflareContext），
// 而模块顶层代码是在 isolate 启动时跑的，那时还没有请求。所以连接池不能在
// import 阶段就建好，必须推迟到第一次真正用 sql 的时候。
// 用 Proxy 保住原来的调用形态：sql`...` 走 apply、sql(rows, ...cols) 也走 apply、
// sql.unsafe / sql.end 等走 get，所有调用方零改动。
let pool: ReturnType<typeof postgres> | undefined = globalForDb._msSql;

function getPool(): ReturnType<typeof postgres> {
  if (!pool) {
    pool = create();
    if (process.env.NODE_ENV !== "production") globalForDb._msSql = pool;
  }
  return pool;
}

type Sql = ReturnType<typeof postgres>;

export const sql: Sql = new Proxy(function () {} as unknown as Sql, {
  apply(_target, _thisArg, args: unknown[]) {
    return (getPool() as unknown as (...a: unknown[]) => unknown)(...args);
  },
  get(_target, prop) {
    return (getPool() as unknown as Record<string | symbol, unknown>)[prop];
  },
}) as Sql;

// 连接池自愈：查询挂起超时后调用，废弃旧池（里面可能全是死 socket）并重建。
// 旧池异步关闭，不阻塞当前请求；正在挂起的查询会随旧池销毁而报错释放。
export function resetSql() {
  const dead = pool;
  pool = create();
  if (process.env.NODE_ENV !== "production") globalForDb._msSql = pool;
  dead?.end({ timeout: 5 }).catch(() => {});
}
