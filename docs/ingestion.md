# 素材采集

## RSS 采集
`lib/rss.ts` 的 `fetchFeed()` + `lib/ingest.ts` 的 `ingestRss()`，源在设置页配置（存 `app_config.rssFeeds`）。每个源可标一个「板块」（自由命名的分类字符串，如「AI 资讯」），采进来的素材归入对应板块。

**并行抓取（2026-07-18 起）**：所有源用 `Promise.allSettled(feeds.map(fetchFeed))` 并行抓取（各源是不同网站、无相互限流，可放心并发），墙钟由单源 20s 抓取超时上限封顶，不随源数线性增长；`allSettled` 保住「一源挂了不影响其他源」的隔离。落库仍按源串行（每源一次批量 upsert，`insertRssItems()`），只占一个写连接，不打爆 transaction pooler。

- **自报 UA**：默认 `media-studio-sync/1.0`（可用 env `SYNC_UA` 覆盖），绝不伪装浏览器
- **预置源库**：`lib/rss-presets.ts` 内置多组按分类整理、逐条实测过的订阅源（AI 官方动态 / AI 科技媒体 / 开发者视角 / AI 工具发布 / 科学与认知 / 财经与加密），设置页「RSS 订阅源」卡片可逐条或整组一键添加
- 新增预置源前先用 `curl -A "media-studio-sync/1.0"` 实测返回 200；伪装浏览器 UA 才能通的源不收（维护约定见 `lib/rss-presets.ts` 头注释）

采集侧防线（2026-07-14 起）：只收发布时间在 `rssRetentionDays` 内的条目，且每源单轮最多 20 条——OpenAI 官方这类归档型 feed 一次给 1000+ 条历史文章，没这道防线会灌满收件箱。需要 AI 关键词过滤的综合源（9to5Mac / Ars Technica）没有纳入，因为本站 RSS 采集不做关键词过滤。

## 英文素材自动翻译（2026-07-18 起）
RSS 源大半是英文，素材流页面全是英文标题很难扫。采集后批量把英文条目的标题+摘要翻成中文：
代码 `lib/translate.ts`（`translateNewMaterials()`）· `POST /api/translate`（设置页「立即翻译」）· 提示词 `translate_system`。

- **引擎独立配置**（设置页「素材翻译引擎」卡片）：默认经聚合中转站调 `deepseek-v4-flash`，开关默认开；key 复用所选引擎在文案引擎卡片里已存的那把，不单独存。此量级（150 条/天）月成本约几元
- **字段复用**：中文写回 `title`/`summary`，英文原文挪进 `title_en`——沿用「title 中文 + title_en 英文」双字段约定，前端零改动
- **防错位**：每批 ≤20 条、请求与返回都带素材 id、按 id 回写；漏译/失败的条目保留英文原样（`title_en` 仍空），下轮自动重试；批次并发跑
- 英文判定：标题+摘要的 CJK 字符占比 < 10%；中文源天然跳过
- 执行时机：每日 cron 第 2 步（采集之后）；手动 RSS 采集也会顺手翻

## 时效性素材生命周期（2026-07-18 简化为一步删除）
RSS 素材超保留期一步删除：`rssRetentionDays`（设置页可改，代码兜底默认 7 天）内没处理的**直接物理删除**。曾经的「置 `expired` 软删 + 宽限期真删」两段式已按用户拍板移除（时效性新闻过期即失去价值，没有捞回场景），`MaterialStatus` 里也不再有 `expired`。被选题引用过的素材不清。手动录入（manual）是资产不是流水，永不清理。

## 每日 cron
Cloudflare Cron Trigger `0 1 * * *`（UTC）= 北京 09:00，由 `worker.ts` 的 scheduled 打 `/api/cron/daily`，走 `runDailyIngest()`：

1. RSS 采集
2. 英文素材翻译（`translateNewMaterials()`，关了开关/没 key 自动跳过）
3. 直接删除超期未处理素材（封面图 24 小时回收，见 `lib/cleanup.ts`；清理时间戳写 sync_state 的 `cleanup` 键）
4. 摘要 / 告警邮件（Resend，env `RESEND_API_KEY`，设置页开关）

采集接口允许 `Authorization: Bearer CRON_SECRET` 绕过门禁。
