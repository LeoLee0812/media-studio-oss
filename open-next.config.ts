import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// OpenNext 的 Cloudflare 适配配置。
// 站内所有页面都是 force-dynamic（见 CLAUDE.md 的目录结构说明），没有 ISR/SSG 需要缓存，
// 所以这里不挂 incrementalCache / tagCache / queue —— 少一层绑定，少一处能出故障的地方。
export default defineCloudflareConfig();
