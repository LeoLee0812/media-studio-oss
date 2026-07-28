import type { NextConfig } from "next";

// 注意：本项目需要 API 路由 + middleware 门禁，故【不使用】output:"export"（区别于其他静态站）。
// 标准 Vercel serverless 部署。
const nextConfig: NextConfig = {
  // postgres.js 是纯 JS 驱动，标记为 serverExternalPackages 避免被打包器错误处理
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
