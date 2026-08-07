// Cloudflare Workers 的真正入口。
//
// OpenNext 会把整个 Next.js 应用编译成 .open-next/worker.js（只有 fetch 处理器）。
// 但本项目还需要一个**定时任务**（原先是 vercel.json 里的 cron），Workers 的定时触发器
// 走的是 scheduled 处理器，OpenNext 那份不带，所以这里自己包一层：
//   fetch     → 原样交给 OpenNext
//   scheduled → 打自己的 /api/cron/daily，带 Bearer CRON_SECRET（与 middleware 的鉴权对齐）
//
// 为什么用 service binding 回调自己而不是 fetch 公网地址：
// Workers 内部直连不出网、不吃额外请求费，也不受自定义域名解析/证书状态影响。
// 万一没绑 service（比如首次部署时 worker 还不存在），退回用 SITE_URL 走公网。

import openNextHandler from "./.open-next/worker.js";

// 只声明用到的部分，不引全局 workers-types（理由同 lib/blob.ts 的注释）
interface Env {
  WORKER_SELF_REFERENCE?: { fetch(req: Request): Promise<Response> };
  CRON_SECRET?: string;
  SITE_URL?: string;
}
interface Ctx {
  waitUntil(p: Promise<unknown>): void;
}

export default {
  fetch: openNextHandler.fetch,

  async scheduled(_event: unknown, env: Env, ctx: Ctx) {
    const base = (env.SITE_URL || "https://media-studio-oss.workers.dev").replace(/\/+$/, "");
    const req = new Request(`${base}/api/cron/daily`, {
      headers: env.CRON_SECRET ? { authorization: `Bearer ${env.CRON_SECRET}` } : {},
    });
    const run = async () => {
      const res = env.WORKER_SELF_REFERENCE
        ? await env.WORKER_SELF_REFERENCE.fetch(req)
        : await fetch(req);
      // 打进 Workers 日志，出问题时 `wrangler tail` 能直接看到当天采集结果
      console.log(`[cron/daily] HTTP ${res.status} ${(await res.text()).slice(0, 500)}`);
    };
    ctx.waitUntil(run());
  },
};
