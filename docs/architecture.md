# 架构与基础设施

## 技术栈
- Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4 + shadcn/base-ui + gsap
- **不用 `output: export`**：本项目需要 API 路由 + middleware 门禁，走标准 Vercel serverless 部署
- 数据库：Supabase 项目，4 张 `ms_` 前缀表

## 文案引擎（四引擎）
提供方定义收口在 **`lib/llm-providers.ts`** 注册表（纯常量，服务端与设置页共用；加一家引擎只改这个文件）：

| 引擎 | 接口 | 默认模型 |
| --- | --- | --- |
| DeepSeek | `@ai-sdk/deepseek` 官方 SDK | `deepseek-v4-pro` |
| 通义千问 | DashScope OpenAI 兼容接口 | `qwen3.7-max` |
| Kimi | Moonshot OpenAI 兼容接口 | `kimi-k3` |
| 聚合中转站（OpenAI 兼容） | 任意 OpenAI 兼容端点（Base URL 可配，默认示例 yunwu.ai） | `deepseek-v4-pro` |

除主文案引擎外还有两套**独立可配的辅助引擎**（默认都经聚合中转站调 `deepseek-v4-flash`，key 复用所选引擎已存的那把）：「轻量任务引擎」（`resolveFlashConfig` → `getFlashModel`，AI 标题重写/小红书高亮/段落 emoji；2026-07-18 前这里写死 DeepSeek 官方 flash，切引擎后会静默继续打 DeepSeek，已修）和「素材翻译引擎」（`resolveTranslateConfig` → `getTranslateModel`，英文素材译中文，见 docs/ingestion.md）。

`lib/llm.ts` 统一出模型；设置页切换，存 `app_config.llmProvider`。各家的 key/model 各存一份（`deepseekApiKey`+`llmModel` / `qwenApiKey`+`qwenModel` / `kimiApiKey`+`kimiModel` / `relayApiKey`+`relayModel`），互不覆盖，切换引擎即时生效。聚合中转引擎（`relay`）接任意 OpenAI 兼容端点：Base URL 在设置页可改（存 `app_config.relayBaseUrl`，env `RELAY_BASE_URL` 兜底，未配置时回落默认示例 `https://yunwu.ai/v1`），自建 OneAPI / New API、OpenRouter 等均可接入。这类中转通常一把 key 通多家模型，`isChatModel` 用「主流文本系前缀白名单 + 多模态关键词黑名单」双保险过滤（默认示例端点 2026-07 实测 `/models` 返回 403 个）。

**模型不写死**：三家都实现了 OpenAI 兼容的 `GET /models`，一把 key 通常能调多个模型。设置页「获取模型」按钮实时拉列表再下拉选（`lib/llm-models.ts` + `POST /api/config/models`），注册表的 `isChatModel` 负责滤掉向量/语音/视觉等非文案模型；拉不动时可切回手动输入。「测试连接」复用同一个请求。

**坑（2026-07 实测，见注册表 `structuredFallback`）**：出稿走 `generateObject`（按 json_schema 返回分字段 JSON），有些模型在这个约束下**不稳定**——不是不支持，而是概率性退化，一旦发生整篇稿子就没了：

- `qwen3.7-max` 返回自造字段 → 降级 `qwen3.7-plus`
- `kimi-k2.5` / `k2.6` 三种退化形态：提前收敛成裸标量（`"1.53"`，合法 JSON 但不是 object）、整段跳出约束改写 markdown、吐上千个空白字符再跟 JSON → 降级 `kimi-k3`

失败时 `reasoning_tokens` 会飙到正常值的 5~10 倍（600~1300 vs 干净模型的 54~160），坏掉的恰好是思考最重的两个模型，指向**约束解码在思考链失控时崩掉**。只降级结构化调用，纯文本生成仍用用户选的模型。

**降级必须对用户可见**：设置页下拉框里这类模型直接标注「（不出稿，将由 X 代写）」，选中后卡片给醒目提示——默默替换掉用户的选择是坏设计（`structuredNote()` / `modelOptionLabel()`）。

**第三方中立声明**：本项目与任何中转站/模型服务商无合作、返佣或广告关系，默认值仅为可替换示例。

## 提示词中心
全部 AI 系统提示词收拢在 `lib/prompt-store.ts` 注册表（20 条，全部 `kind: "file"`），默认值统一来自 `prompts/` 目录的 md 文件（写作规则唯一事实源），覆盖值存 `ms_sync_state.prompt_overrides`，`/prompts` 页可视化编辑、保存即生效。`prompts/system/` 存放原先写死在 `prompt-store.ts` 里的内置系统提示词（虚构红线、客观性要求、3 套封面风格放 `system/cover/`、小红书高亮与 emoji 指令放 `system/xhs/`、选题/调研/配图/标题/改稿等），搬迁后 `prompt-store.ts` 只剩注册表结构与读写逻辑。

> **硬性约定**：新增/改动 AI 调用时必须从 `getPrompt(id)` 取词，不许把提示词写死在调用点。

## 数据库连接方式（关键决策）
任务原设计是「service_role key + PostgREST」，但 service_role key 无法从 MCP/CLI 自动获取。最终采用等价且更自包含的方案：

- 新建专用 Postgres 登录角色 **`ms_app`**（有独立密码），只在服务端经 **Supabase transaction pooler**（`aws-0-<region>.pooler.supabase.com:6543`）用 `postgres.js` 直连
- 4 张表 **RLS 全开**，**只对 `ms_app` 角色建策略**（`using(true)`）；anon/publishable **无任何策略 = 默认全拒**
- 前端不直连数据库，所有读写走 Next.js server route（`lib/db.ts` 的 `sql`）
- 连接串在 env `DATABASE_URL`（本地 `.env.local` + Vercel env）
- 安全性等价于原设计：特权访问仅存在于服务端、门禁之后；公开 key 打 `ms_` 表读不到
- 若日后拿到 service_role key，可平滑切回 REST，但当前方案无需外部 key

### 连接自愈（2026-07-11）
serverless 下到 pooler 的连接会间歇挂死（新建连接约半数挂起、旧 socket 冻结后复用即死锁，曾致页面挂 300 秒）。对策三层：

1. `db.ts` 生产环境 `connect_timeout: 3s` / `keep_alive` / `max_lifetime: 5min` + `resetSql()` 活绑定重建池
2. `queries.ts` 读查询包 `guardRead`（5 秒超时 → 重建池 → 重试一次）
3. 交互写包 `guardWrite`（10 秒超时 → 重建池 → 报错不重试）

触发时打 `[db-watchdog]` 日志，可在 Vercel 后台观察。

> **硬性约定**：改动查询函数时保持这个包裹结构。

## 4 张表
| 表 | 用途 |
| --- | --- |
| `ms_materials` | 素材（source: rss / manual；`dedupe_key` 唯一保证幂等） |
| `ms_topics` | 选题（angle 一句话角度、research 调研回溯、material_ids、status: idea / selected / drafting / done / dropped） |
| `ms_drafts` | 稿件（platform 当前只有 wechat，meta 存 style / cover / illustrations 等） |
| `ms_sync_state` | 键值存储：采集状态、全站配置 app_config、提示词覆盖、封面图 base64 缓存、小红书高亮缓存 |

迁移在 `supabase/migrations/`（`0001_ms_init.sql`）。

## 门禁
- `middleware.ts` 全站门禁：cookie `ms_auth` = HMAC-SHA256(ACCESS_PASSWORD, key=AUTH_SECRET)，httpOnly
- 未登录页面 → 重定向 `/login`；裸调 API → 401
- 采集接口额外允许 `Authorization: Bearer CRON_SECRET`
- **公开模式**：没配 `ACCESS_PASSWORD` 时 `isGateEnabled()` 为假，middleware 全部放行、`/login` 跳回落地页。
  页面侧统一用 `hasWorkspaceAccess()`（公开模式恒真）判断，否则导航栏会消失、`/` 会被落地页顶掉；
  顶栏的「退出登录」按钮此时不渲染（`SiteHeader showLogout`）。
  安全代偿：`/api/config` 在公开模式下把所有密钥字段抹成空串（`maskSecret`），只回 `*Enabled` 布尔——
  设置页仍可写入新 key，但已存的 key 不回显，不会被访客读走。本仓库的在线演示站走的就是这个模式。

## 环境变量（见 `.env.example`）
- 必需：`DATABASE_URL` · `AUTH_SECRET`（`ACCESS_PASSWORD` 留空 = 公开模式，填了才启用门禁） · `CRON_SECRET` · `DEEPSEEK_API_KEY` · `LLM_MODEL`
- 可选引擎：`LLM_PROVIDER=qwen|kimi|relay` · `QWEN_API_KEY` · `QWEN_MODEL` · `KIMI_API_KEY` · `KIMI_MODEL` · `RELAY_API_KEY` · `RELAY_MODEL` · `RELAY_BASE_URL`（聚合中转端点，默认示例 https://yunwu.ai/v1，可换任意 OpenAI 兼容端点；key 平时走设置页存 DB，env 仅兜底）
- 配图搜图：`PEXELS_API_KEY` / `PIXABAY_API_KEY`（与 ppt-master skill 同一套 key）
- 封面生图：`IMAGE_API_BASE`（任意 OpenAI 兼容生图端点，默认示例 https://yunwu.ai/v1）· `IMAGE_API_KEY` · `IMAGE_MODEL`（默认 gpt-image-2）· `IMAGE_QUALITY`（默认 medium）
- 邮件：`RESEND_API_KEY`（每日采集摘要/告警）
