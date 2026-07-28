import postgres from "postgres";

// Supabase transaction pooler 直连（服务端专用）。
// 使用 ms_app 角色，RLS 只放行该角色，anon/publishable 默认全拒。
// transaction pooler 必须 prepare:false；serverless 下连接数保持较小。
const globalForDb = globalThis as unknown as {
  _msSql?: ReturnType<typeof postgres>;
};

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("缺少 DATABASE_URL 环境变量");
  return postgres(url, {
    prepare: false,
    ssl: "require",
    max: 5,
    // 空闲连接保留 2 分钟：实测挂起集中在「新建连接到 pooler」这一步（约一半概率挂死），
    // 已建立的连接一直健康，所以尽量少重连、多复用
    idle_timeout: 120,
    // 生产（Vercel hnd1 与数据库同区）健康连接建立不到 1 秒，3 秒还没建上基本就是挂死了，
    // 快速放弃让 postgres.js 自动换新连接重试；本地开发跨国链路慢（实测 1.5-4.8 秒），放宽到 15
    connect_timeout: process.env.VERCEL ? 3 : 15,
    // 连接最长存活 5 分钟：serverless 实例可能被冻结/休眠，醒来后旧 socket 已死，
    // 复用它查询会无限挂起（曾导致页面挂满 300 秒函数超时）。定期换新连接兜底。
    max_lifetime: 60 * 5,
    // TCP 保活（秒）：尽早暴露对端已断开的连接，而不是等到查询时才卡死
    keep_alive: 30,
  });
}

// 用 let + 具名导出：ES module 是活绑定，resetSql 重建后所有引用方拿到的都是新池
export let sql = globalForDb._msSql ?? create();
if (process.env.NODE_ENV !== "production") globalForDb._msSql = sql;

// 连接池自愈：查询挂起超时后调用，废弃旧池（里面可能全是死 socket）并重建。
// 旧池异步关闭，不阻塞当前请求；正在挂起的查询会随旧池销毁而报错释放。
export function resetSql() {
  const dead = sql;
  sql = create();
  if (process.env.NODE_ENV !== "production") globalForDb._msSql = sql;
  dead.end({ timeout: 5 }).catch(() => {});
}
