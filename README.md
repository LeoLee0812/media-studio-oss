# Media Studio

![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=nextdotjs)
![React](https://img.shields.io/badge/React-19-087ea4?style=flat-square&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript)
![Tailwind](https://img.shields.io/badge/Tailwind-v4-38bdf8?style=flat-square&logo=tailwindcss)
![Supabase](https://img.shields.io/badge/Supabase-Postgres-3fcf8e?style=flat-square&logo=supabase)
![Last Commit](https://img.shields.io/github/last-commit/LeoLee0812/media-studio-oss?style=flat-square&logo=github)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

自媒体「素材 → 稿件」一站式工作台。RSS 订阅采集选题素材，AI 把素材扩写成**公众号成稿（正文 + 自动配图 + AI 封面）**，再一键导出**小红书 / 知乎专栏 / 推特长篇 / 抖音长文**。自部署、单用户，密码门禁可选（不配就是公开站）。

```
RSS 订阅源 ──┐
（自己挑赛道） ├─→ 素材收件箱 ─→ 立为选题 ─→ 回溯原文调研 ─→ 母稿 ─→ 公众号成稿
手动录入 ────┘                                                      │
自己的知识库 ─┘                        ┌──────────┬──────────┼──────────┬──────────┐
                                    排版预览   小红书长文  知乎专栏  推特长篇  抖音长文
                                  （复制即贴）（高亮+emoji）（粘即成文）（X Articles）（三段式）
```

## 这个项目为什么存在：自媒体是获客的前置环节

它出自 **OpenFDE 社区**——一个面向「给企业做 FDE（Forward Deployed Engineer，前向部署工程师）」的社区。对做 FDE 的人来说，真正的瓶颈往往不是交付能力，而是**怎么让有 AI 落地需求的企业先认识你**。

这个工作台负责的就是那段前置链路：

```
订阅 AI / FDE / 企业增效方向的 RSS
        ↓  素材自动进收件箱，英文自动翻译
把行业动态 + 自己的知识库，写成有观点的内容
        ↓  一份母稿 → 五个平台的变体
公众号 / 小红书 / 知乎 / 推特 / 抖音 持续输出
        ↓  内容曝光 → 有需求的人主动找来
受众沉淀进私域，再转化成 FDE 客户
```

换句话说：**先用内容把人吸引过来，再谈交付。** 所以这个工具的重点不是「多快能量产文章」，而是让你能围绕一个明确赛道，长期、稳定地输出别人愿意读的东西——素材源是你自己挑的，观点和知识库是你自己的，AI 只负责把它们组织成各平台吃得下的形态。

如果你做的不是 FDE 方向，把上面的「AI / FDE / 企业增效」换成你自己的赛道，这条链路照样成立。怎么换见下面的[「按你的赛道挑订阅源」](#按你的赛道挑订阅源)。

|  |  |
| --- | --- |
| ![首页](docs/screenshots/landing.png) | ![素材流](docs/screenshots/inbox.png) |

![稿件页：左侧 Markdown 编辑，右侧公众号排版实时预览，一键复制到公众号/小红书/抖音](docs/screenshots/draft.png)

## 在线体验

**https://media-studio-oss.saveme505.help** — 免密码，直接进
（备用地址：<https://media-studio-oss.vercel.app>）

> 公共演示环境：未配置文案引擎 Key，AI 生成类功能不可用（自部署后在设置页填自己的 Key 即可）；演示数据公共可写，请勿存放重要内容。
>
> 演示站开着**只读模式**（`READ_ONLY=1`）：随便逛，但新增/修改/删除都会被拒绝，省得演示数据被写乱。自部署不配这一项就是正常可写站。
>
> 自部署时**配上 `ACCESS_PASSWORD` 就会启用全站密码门禁**（未登录页面跳 `/login`、裸调 API 返 401）；留空即公开模式，像这个演示站一样免登录。公开模式下配置接口不回显已存的 API Key，避免密钥被访客读走。

## 功能

- **素材采集**：内置多组分类预置 RSS 源（AI 官方动态 / AI 科技媒体 / 开发者视角 / AI 工具发布 / 科学与认知 / 财经与加密），设置页一键添加；也可自定义添加任意 RSS 2.0 / Atom 源；每日 cron 自动采集，英文素材自动翻译标题摘要
- **选题工作流**：素材一键立为选题，AI 建议切入角度，自动回溯抓取原文提炼调研笔记
- **公众号成稿**：母稿两步制生成，反 AI 味写作规则 + 虚构红线内置；自动图库配图（Pexels/Pixabay）或 AI 现画知识图解；7 套风格的 AI 封面生成（支持模板参考图直生）
- **多平台导出**：公众号排版预览复制即贴（内联样式富文本）；小红书长文（AI 挑高亮句 + 段落 emoji）；知乎专栏（粘贴即成文，图片自动转存）；推特长篇（X Articles）；抖音长文（标题/摘要/正文三段式）
- **排版可写模式**：右侧公众号预览可直接改稿——点段落原位改 Markdown、悬停上移/下移/插入/删除、标题可点改，改动实时回写同一份正文
- **洗稿模式**：粘贴任意中英文原文，自动抓取文内链接补充上下文，一键出稿（也是把自己的知识库文档变成稿件的入口）
- **提示词中心**：全部系统提示词可视化编辑，改文风不用改代码
- **多引擎**：DeepSeek / 通义千问 / Kimi / 任意 OpenAI 兼容中转站，设置页在线切换；正文、轻量任务、翻译三套引擎独立可配

## 按你的赛道挑订阅源

**素材源决定你的内容长什么样**，所以这一步别照抄默认值——按你要做的自媒体方向来配。

设置页 → 「RSS 订阅源」有两种加法：展开**预置源库**整组添加（默认那几组偏 AI 与科技），或者在下面**手动填任意 RSS 2.0 / Atom 地址**。想加多少加多少，随时删。

### 不知道该订哪些源？让你的 AI Agent 去找

你不需要自己满世界翻 RSS 地址。**部署的时候顺手让 Claude Code / Codex / Cursor 帮你查一轮**，把下面这段改一下方向直接丢给它：

````text
我在部署 media-studio（自媒体素材→稿件工作台），要做「<你的方向，例如：AI 落地咨询 / FDE 前向部署 / 跨境电商 / 医疗器械合规>」
方向的自媒体，请帮我配订阅源：

1. 找 12~20 个这个方向**还在更新**的优质 RSS 源，覆盖这几类：
   - 行业官方 / 厂商博客（一手信息）
   - 垂直媒体与资讯站
   - 从业者个人博客 / Newsletter（观点密度高的）
   - 社区热帖（Reddit 子版、Hacker News 关键词流、V2EX 节点等都有 RSS）
   - 如果这个方向有英文源更强，就多给英文源（站内会自动翻译标题摘要）
2. 每个源逐一验证：curl 一下拿到 200 且是合法 RSS/Atom XML，最近 30 天内有新条目；
   拿不到就换掉，别把死链塞给我。
3. 验证通过的按「分类 + 名称 + 地址 + 一句话它值得订的理由」列成表格给我，
   我在设置页手动添加；如果你能访问我的站点/数据库就直接替我写进去。
4. 最后告诉我哪些源更新快（适合追热点）、哪些偏深度（适合攒观点稿）。
````

小技巧：
- **没有 RSS 的站也能订**——让 Agent 用 RSSHub（`https://rsshub.app/...`，支持自建）或 RSS 桥接服务生成一条。
- **一次别加太多**：先上 10 条左右跑一周，看收件箱里哪些源真的能出选题，再决定加还是删。
- **换方向随时改**：源是配置不是代码，改完下次采集就生效。

### 把自己的知识库变成素材

RSS 给的是行业动态，**真正让内容有辨识度的是你自己那套东西**（方法论、项目复盘、踩坑记录、客户常问的问题）。两条路进来：

- **洗稿模式**（`/rewrite`）：把你知识库里的一篇笔记 / 文档整段粘进去，直接出成稿——它会自动抓取文内链接补上下文。
- **手动录入素材**：在素材流页面手动新建一条素材，标题 + 正文粘你自己的内容，之后走和 RSS 素材完全一样的「立选题 → 调研 → 母稿 → 成稿」流程。

想批量导入的话（比如几十篇 Obsidian 笔记），让你的 Agent 读 `lib/queries.ts` 里的素材写入函数，写个一次性脚本灌进 `ms_materials` 表即可。

## 安装

### 方式一：让 AI 编程代理帮你装（推荐）

把下面整段提示词复制给 **Claude Code / Codex / Cursor** 等编程 Agent，它会替你完成全部安装：

````text
请帮我部署开源项目 media-studio（仓库 https://github.com/LeoLee0812/media-studio-oss）。
这是一个 Next.js 16 全栈应用，数据库用 Supabase Postgres（专用角色直连，不用 service key）。
按顺序做：

1. git clone https://github.com/LeoLee0812/media-studio-oss.git 并进入目录，npm install。

2. 数据库初始化（需要一个 Supabase 项目，没有就提示我去 https://supabase.com 免费创建一个）：
   a. 先执行建角色语句（密码用 openssl rand -hex 16 生成）：
      create role ms_app login password '<生成的密码>';
      grant usage on schema public to ms_app;
      grant ms_app to postgres;
   b. 再执行仓库里 supabase/migrations/0001_ms_init.sql 的全文。
   如果你能直接访问我的 Supabase（MCP 或 CLI），就替我执行；
   否则把上面两段 SQL 整理好，告诉我粘到 Supabase 后台 SQL Editor 里跑。

3. 生成 .env.local（参照仓库 .env.example 的中文注释）：
   - DATABASE_URL：transaction pooler 连接串，格式
     postgresql://ms_app.<项目ref>:<第2步的密码>@aws-0-<区域>.pooler.supabase.com:6543/postgres
     （项目 ref 和区域在 Supabase 后台 Settings → Database 能看到）
   - ACCESS_PASSWORD：想加锁就给我设一个好记的站点访问密码并最后告诉我；
     不想要密码（公开站）就留空或不写这一项，全站免登录
   - AUTH_SECRET：openssl rand -hex 32
   - CRON_SECRET：openssl rand -hex 24
   - 文案引擎 Key（DEEPSEEK_API_KEY 等）我稍后自己在网站设置页填，先跳过。

4. npm run dev 启动，替我验证：打开 http://localhost:3000（配了 ACCESS_PASSWORD 就先登录），
   到设置页「RSS 订阅源」展开预置源库，整组添加「AI 科技媒体」，保存后点「手动拉取」，
   确认素材流页面出现素材。

4.5 顺便替我配订阅源：我要做「<填你的方向，如 AI 落地咨询 / FDE 前向部署>」方向的自媒体，
   请找 12~20 个这个方向还在更新的优质 RSS 源（官方博客 / 垂直媒体 / 从业者 Newsletter /
   社区热帖，英文源也要），逐个 curl 验证返回 200、是合法 RSS/Atom、最近 30 天有新条目，
   然后列成「分类 + 名称 + 地址 + 一句话理由」的表格给我，我在设置页添加。没有 RSS 的站
   用 RSSHub 生成。

5. 如果我要上线：推到我自己的 GitHub 仓库 → Vercel 导入 → 环境变量照 .env.local 配齐
   （CRON_SECRET 一定要配，vercel.json 里的每日采集 cron 靠它鉴权）→ 部署完把地址给我。

注意：所有生成的密钥只写进 .env.local（已被 .gitignore 忽略），不要出现在任何会提交的文件里；
每一步出问题就停下来告诉我卡在哪，不要带着错误继续。
````

### 方式二：手动安装

<details>
<summary>展开手动安装步骤（4 步）</summary>

**1. 建库（Supabase）**：新建 [Supabase](https://supabase.com) 项目，SQL Editor 里先建角色再跑迁移：

```sql
create role ms_app login password '<你的DB密码>';
grant usage on schema public to ms_app;
grant ms_app to postgres;
```

然后执行 `supabase/migrations/0001_ms_init.sql` 全文（4 张表 + RLS，anon key 默认全拒）。

**2. 配置环境变量**：`cp .env.example .env.local`，必填：

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | `postgresql://ms_app.<projectRef>:<密码>@aws-0-<区域>.pooler.supabase.com:6543/postgres` |
| `ACCESS_PASSWORD` | 全站访问密码；**留空 = 公开站**，免登录直接用 |
| `READ_ONLY` | 填 `1` 则全站禁写（公开演示站用）；留空 = 正常可写 |
| `AUTH_SECRET` | `openssl rand -hex 32` |
| `DEEPSEEK_API_KEY` 等 | 文案引擎任选一家，也可部署后在设置页填 |

**3. 本地跑起来**：`npm install && npm run dev`，进站后（配了访问密码就先登录）到设置页添加 RSS 订阅源（预置源库一键添加、或按上面「按你的赛道挑订阅源」自定义）并「手动拉取」。

**4. 部署（Vercel）**：推到 GitHub 后在 Vercel 导入。`vercel.json` 已带每日采集 cron（UTC 01:00）；环境变量补上 `.env.local` 的内容和 `CRON_SECRET`，可选 `SITE_URL`（摘要邮件回链）与 `RESEND_API_KEY`（每日摘要邮件）。

</details>

## 第三方服务与中立声明

本项目**不推广、不背书任何第三方服务**，与文中出现的任何中转站/模型服务商（含默认示例 yunwu.ai）**没有合作、返佣或广告关系**：

- 文案引擎四选一：DeepSeek / 通义千问 / Kimi 官方 API，或**任意 OpenAI 兼容端点**（自建 OneAPI / New API、OpenRouter、其他中转站均可），设置页可改 Base URL
- 封面/配图的生图端点（`IMAGE_API_BASE`）同样可指向任意 OpenAI 兼容服务
- 代码中出现的默认地址只是「开箱能跑」的示例占位，随时可换，欢迎按自己的供应商偏好接入
- 在线演示站同样不为任何服务背书

## 技术要点

- **Next.js 16 App Router 全栈**，无独立后端；前端不直连数据库，读写全走 server route
- **安全模型**：4 张表 RLS 全开、仅 `ms_app` 角色有策略；服务端经 transaction pooler 直连；全站 HMAC 签名 cookie 门禁（可选，不配 `ACCESS_PASSWORD` 即公开模式，此时配置接口不回显密钥）；`READ_ONLY=1` 时 middleware 拒绝一切写请求；采集/生成侧 URL 均过 SSRF 校验
- **serverless 连接自愈**：针对 pooler 挂死场景的三层防御（超时→重建连接池→重试），见 `lib/db.ts` / `lib/queries.ts`
- **提示词单一事实源**：全部写作规则在 `prompts/` 目录 md 文件，运行时可被数据库覆盖值热替换
- **结构化输出降级**：部分模型 `generateObject` 概率性退化（实测记录在 `docs/architecture.md`），注册表按模型自动降级并在 UI 明示

## 目录结构

```
app/          页面 + API 路由
lib/          核心逻辑（采集/生成/封面/配图/排版渲染/连接自愈）
components/   业务组件 + 设置页域卡片
prompts/      写作规则与系统提示词（单一事实源）
supabase/     建表 SQL
docs/         子系统文档
```

## License

[MIT](LICENSE)
