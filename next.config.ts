import path from "node:path";
import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// 注意：本项目需要 API 路由 + middleware 门禁，故【不使用】output:"export"（区别于其他静态站）。
// 部署形态是 Cloudflare Workers：next build 之后由 @opennextjs/cloudflare 打成一个 Worker。

// ===== 迁 Cloudflare 时最难查的一个坑：postgres.js 得用它的 Workers 版 =====
// postgres.js 有两份实现：
//   src/index.js     走 node:net + node:tls —— Node/Vercel 上用的那份
//   cf/src/index.js  走 cloudflare:sockets  —— Workers 上唯一能用的那份
// 包的 exports 里虽然写了 "workerd" 条件指向后者，但 Next 的服务端构建按 Node 环境解析条件，
// 打出来的产物里塞的是前者；到了 workerd 上建连直接 ERR_OPTION_NOT_IMPLEMENTED，
// 而 postgres.js 会疯狂重连，最终报成一句极具误导性的
// "Too many subrequests by single Worker invocation"（查了半天才定位到根因）。
// 所以这里把 postgres 硬指到 cf 版；同理【绝不能】把它写进 serverExternalPackages——
// 标成 external 就不参与打包，别名也就失效了。
// Turbopack 的 resolveAlias 要「相对项目根」的写法，webpack 的 alias 要绝对路径，两边不通用
const postgresCfRelative = "./node_modules/postgres/cf/src/index.js";
const postgresCfAbsolute = path.join(process.cwd(), "node_modules/postgres/cf/src/index.js");

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres"],
};

export default nextConfig;

// 让 `next dev` 也能拿到 Cloudflare 的绑定（KV/R2 等，见 lib/blob.ts）。
// 只在开发期生效，生产构建时是空操作。
initOpenNextCloudflareForDev();
