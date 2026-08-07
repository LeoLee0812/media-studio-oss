import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// 注意：本项目需要 API 路由 + middleware 门禁，故【不使用】output:"export"（区别于其他静态站）。
// 部署形态是 Cloudflare Workers：next build 之后由 @opennextjs/cloudflare 打成一个 Worker。
// 数据库是 Cloudflare D1（绑定名 DB，见 wrangler.jsonc），走绑定不走网络驱动，
// 所以这里不需要任何 serverExternalPackages / 打包器别名。
const nextConfig: NextConfig = {};

export default nextConfig;

// 让 `next dev` 也能拿到 Cloudflare 的绑定（D1 / KV，见 lib/db.ts 与 lib/blob.ts）。
// 只在开发期生效，生产构建时是空操作。
initOpenNextCloudflareForDev();
