# Media Studio

![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=nextdotjs)
![React](https://img.shields.io/badge/React-19-087ea4?style=flat-square&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript)
![Tailwind](https://img.shields.io/badge/Tailwind-v4-38bdf8?style=flat-square&logo=tailwindcss)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-f38020?style=flat-square&logo=cloudflare)
![Supabase](https://img.shields.io/badge/Supabase-Postgres-3fcf8e?style=flat-square&logo=supabase)
![Last Commit](https://img.shields.io/github/last-commit/LeoLee0812/media-studio-oss?style=flat-square&logo=github)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

自媒体「素材 → 稿件」一站式工作台。RSS 订阅采集选题素材，AI 把素材扩写成**公众号成稿（正文 + 自动配图 + AI 封面）**，再一键导出**小红书 / 知乎专栏 / 推特长篇 / 抖音长文**。自部署、单用户，密码门禁可选（不配就是公开站）。

整站跑在 **Cloudflare Workers** 上——一个 Worker 装下全部页面与 API，定时采集用 Cron Triggers，图片存 KV / R2，数据库走 Hyperdrive 连 Supabase Postgres。免费额度就能长期跑。

```
RSS 订阅源 ──┐
（自己挑赛道） ├─→ 素材收件箱 ─→ 立为选题 ─→ 回溯原文调研 ─→ 母稿 ─→ 公众号成稿
手动录入 ────┘                                                      │
自己的知识库 ─┘                        ┌──────────┬──────────┼──────────┬──────────┐
                                    排版预览   小红书长文  知乎专栏  推特长篇  抖音长文
                                  （复制即贴）（高亮+emoji）（粘即成文）（X Articles）（三段式）
```

## 它解决什么问题

做自媒体真正费时间的不是「写」，是写之前和写之后：**每天翻十几个信息源找选题**，写完还要为公众号、小红书、知乎、推特、抖音各排一遍版。

这个工作台把这两头都接管了：订阅源自动进收件箱（英文自动翻译），一份母稿自动派生出五个平台各自吃得下的形态。你只负责挑选题和给观点。

素材源是你自己挑的，观点和知识库是你自己的，AI 只负责组织形态——所以它不是「一键量产文章」的工具，而是让你能围绕一个明确赛道长期稳定输出。怎么按你的方向配源见下面的[「按你的赛道挑订阅源」](#按你的赛道挑订阅源)。

|  |  |
| --- | --- |
| ![首页](docs/screenshots/landing.png) | ![素材流](docs/screenshots/inbox.png) |

![稿件页：左侧 Markdown 编辑，右侧公众号排版实时预览，一键复制到公众号/小红书/抖音](docs/screenshots/draft.png)

## 在线体验

**https://studio.leolee0812.site** — 免密码，直接进

> 公共演示环境：未配置文案引擎 Key，AI 生成类功能不可用（自部署后在设置页填自己的 Key 即可）。
>
> 演示站开着**只读模式**（`READ_ONLY=1`）：随便逛，但新增/修改/删除都会被拒绝，省得演示数据被写乱。自部署不配这一项就是正常可写站。
>
> 自部署时**配上 `ACCESS_PASSWORD` 就会启用全站密码门禁**（未登录页面跳 `/login`、裸调 API 返 401）；留空即公开模式，像这个演示站一样免登录。公开模式下配置接口不回显已存的 API Key，避免密钥被访客读走。

## 功能

- **素材采集**：内置多组分类预置 RSS 源（AI 官方动态 / AI 科技媒体 / 开发者视角 / AI 工具发布 / 科学与认知 / 财经与加密），设置页一键添加；也可自定义添加任意 RSS 2.0 / Atom 源；每日 Cron Trigger 自动采集，英文素材自动翻译标题摘要
- **选题工作流**：素材一键立为选题，AI 建议切入角度，自动回溯抓取原文提炼调研笔记
- **公众号成稿**：母稿两步制生成，反 AI 味写作规则 + 虚构红线内置；自动图库配图（Pexels/Pixabay）或 AI 现画知识图解；7 套风格的 AI 封面生成（支持模板参考图直生）
- **配图与封面预设**：设置页预设一次「文内配图方式（搜图 / AI 生图解 / 不配图）+ AI 图解风格与张数 + 封面风格」，之后每篇出稿自动照办，不用生成完再逐篇挑；稿件页仍可逐篇临时改
- **正文粘贴图片**：稿件正文里直接 ⌘V 粘贴截图或拖入图片文件，浏览器内压缩后传 Cloudflare KV / R2，换成自家域名下的直链插入正文
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
我在部署 media-studio（自媒体素材→稿件工作台），要做「<你的方向，例如：AI 落地咨询 / 跨境电商 / 医疗器械合规>」
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
- **批量导入本地文件夹**（素材流 →「添加素材」→「批量导入」）：把整个 Obsidian vault（或任意装着 Markdown 的目录）拖进弹窗，或点「选择文件夹」，几十上百篇笔记一次入库。frontmatter 的 title / tags / date 自动解析，板块默认按笔记所在的首层文件夹归类，同一路径重复导入会自动跳过。详见 [docs/local-import.md](docs/local-import.md)。

> 笔记内容由浏览器本地读取解析，只发往你自己这份部署的 `/api/materials/bulk`，不经任何第三方。

## 安装

### 方式一：让 AI 编程代理帮你装（推荐）

把下面整段提示词复制给 **Claude Code / Codex / Cursor** 等编程 Agent，它会替你完成全部安装：

````text
请帮我部署开源项目 media-studio（仓库 https://github.com/LeoLee0812/media-studio-oss）。
这是一个 Next.js 16 全栈应用，部署形态是 Cloudflare Workers（@opennextjs/cloudflare），
数据库用 Supabase Postgres，经 Cloudflare Hyperdrive 连接。按顺序做：

1. git clone https://github.com/LeoLee0812/media-studio-oss.git 并进入目录，npm install。

2. 数据库初始化（需要一个 Supabase 项目，没有就提示我去 https://supabase.com 免费创建一个）：
   a. 先执行建角色语句（密码用 openssl rand -hex 16 生成）：
      create role ms_app login password '<生成的密码>';
      grant usage on schema public to ms_app;
      grant ms_app to postgres;
   b. 再执行仓库里 supabase/migrations/0001_ms_init.sql 的全文。
   如果你能直接访问我的 Supabase（MCP 或 CLI），就替我执行；
   否则把上面两段 SQL 整理好，告诉我粘到 Supabase 后台 SQL Editor 里跑。

3. Cloudflare 侧准备（需要一个免费 Cloudflare 账号，wrangler 登录或给 API Token）：
   a. 建 KV 命名空间存图片：npx wrangler kv namespace create media
   b. 建 Hyperdrive 配置指向第 2 步的 Supabase 连接串：
      npx wrangler hyperdrive create media-studio-db --connection-string="postgresql://ms_app.<项目ref>:<密码>@aws-0-<区域>.pooler.supabase.com:6543/postgres"
      ⚠️ 这一步不能省：Workers 直连 Supabase 的 TLS 握手会失败，必须走 Hyperdrive。
   c. 把两个 id 填进 wrangler.jsonc 的 kv_namespaces 与 hyperdrive 段。

4. 配置密钥（wrangler secret put <名字>，逐个填）：
   - ACCESS_PASSWORD：想加锁就给我设一个好记的站点访问密码并最后告诉我；
     不想要密码（公开站）就跳过这一项，全站免登录
   - AUTH_SECRET：openssl rand -hex 32
   - CRON_SECRET：openssl rand -hex 24
   - SITE_URL：部署后的站点地址
   - 文案引擎 Key（DEEPSEEK_API_KEY 等）我稍后自己在网站设置页填，先跳过。
   本地开发用的同名变量写进 .dev.vars（已被 .gitignore 忽略）。

5. npm run deploy 部署，替我验证：打开站点地址（配了 ACCESS_PASSWORD 就先登录），
   到设置页「RSS 订阅源」展开预置源库，整组添加「AI 科技媒体」，保存后点「手动拉取」，
   确认素材流页面出现素材。

5.5 顺便替我配订阅源：我要做「<填你的方向>」方向的自媒体，
   请找 12~20 个这个方向还在更新的优质 RSS 源（官方博客 / 垂直媒体 / 从业者 Newsletter /
   社区热帖，英文源也要），逐个 curl 验证返回 200、是合法 RSS/Atom、最近 30 天有新条目，
   然后列成「分类 + 名称 + 地址 + 一句话理由」的表格给我，我在设置页添加。没有 RSS 的站
   用 RSSHub 生成。

注意：所有生成的密钥只写进 wrangler secret 或 .dev.vars（后者已被 .gitignore 忽略），
不要出现在任何会提交的文件里；每一步出问题就停下来告诉我卡在哪，不要带着错误继续。
````

### 方式二：手动安装

<details>
<summary>展开手动安装步骤（5 步）</summary>

**1. 建库（Supabase）**：新建 [Supabase](https://supabase.com) 项目，SQL Editor 里先建角色再跑迁移：

```sql
create role ms_app login password '<你的DB密码>';
grant usage on schema public to ms_app;
grant ms_app to postgres;
```

然后执行 `supabase/migrations/0001_ms_init.sql` 全文（4 张表 + RLS，anon key 默认全拒）。

**2. 建 Cloudflare 资源**：

```bash
npx wrangler kv namespace create media          # 图片存储，记下返回的 id
npx wrangler hyperdrive create media-studio-db \
  --connection-string="postgresql://ms_app.<projectRef>:<密码>@aws-0-<区域>.pooler.supabase.com:6543/postgres"
```

把两个 id 填回 `wrangler.jsonc` 的 `kv_namespaces[0].id` 与 `hyperdrive[0].id`。

**3. 配置密钥**：

| 变量 | 说明 | 怎么配 |
| --- | --- | --- |
| `ACCESS_PASSWORD` | 全站访问密码；**不配 = 公开站**，免登录直接用 | `wrangler secret put` |
| `READ_ONLY` | 填 `1` 则全站禁写（公开演示站用）；不配 = 正常可写 | `wrangler secret put` |
| `AUTH_SECRET` | `openssl rand -hex 32` | `wrangler secret put` |
| `CRON_SECRET` | `openssl rand -hex 24`，每日采集定时任务靠它鉴权 | `wrangler secret put` |
| `SITE_URL` | 站点对外地址，邮件回链与图片直链要用 | `wrangler secret put` |
| `DEEPSEEK_API_KEY` 等 | 文案引擎任选一家，也可部署后在设置页填 | 设置页 |

本地开发把同名变量写进 `.dev.vars`（已被 `.gitignore` 忽略）。完整变量清单见 `.env.example`。

**4. 本地跑起来**：`npm install && npm run preview`（先构建再起本地 workerd，能拿到 KV/Hyperdrive 绑定）。纯前端调试也可以 `npm run dev`。

**5. 部署**：`npm run deploy`。`wrangler.jsonc` 已带每日采集 Cron Trigger（UTC 01:00 = 北京 09:00）。想挂自定义域名，在 Cloudflare 面板给这个 Worker 加一条 Custom Domain 即可（证书自动签发）。

可选：`RESEND_API_KEY` + `NOTIFY_TO` 开每日摘要邮件。

</details>

## 部署在 Cloudflare 上要知道的四件事

这个项目原本跑在 Vercel 上，迁到 Cloudflare Workers 时踩到的坑都写在这儿了，自部署可以少走弯路：

1. **数据库必须走 Hyperdrive，不能直连。** Workers 能和 Supabase 建 TCP、SSLRequest 也回 `S`，但 `startTls()` 一律 `TLS Handshake Failed`（6543 / 5432 都一样）。Hyperdrive 免费版就能用，配好之后连接串换成它给的本地串即可。
2. **postgres.js 得用它的 Workers 版。** 这个包里有两份实现，`src/index.js` 走 `node:net`/`node:tls`，`cf/src/index.js` 走 `cloudflare:sockets`；靠 `serverExternalPackages: ["postgres"]` 把它留给 OpenNext 的 esbuild 去解析（esbuild 带 `workerd` 条件），才会挑中后者。一旦被 Turbopack 提前打进产物，运行时就会拿到 Node 版，报出极具误导性的 `Too many subrequests`。
3. **单次调用只有 50 个子请求（免费版），重定向也算。** 十几个 RSS 源一起抓必然超。所以采集被拆成「编排 + 分片」：`/api/ingest/rss` 不带参数是编排层，把源切片后逐片回调自己，每次调用各拿一份新的预算。分片大小是 `RSS_FEEDS_PER_INVOCATION`（默认 6）。
4. **图片直链走自家域名。** 不再依赖第三方对象存储：粘贴的截图与 AI 配图都进 KV（或 R2），由 `/f/<key>` 路由读出。公众号、知乎抓图时看到的也是你自己的域名。

## 第三方服务与中立声明

本项目**不推广、不背书任何第三方服务**，与文中出现的任何中转站/模型服务商（含默认示例 yunwu.ai）**没有合作、返佣或广告关系**：

- 文案引擎四选一：DeepSeek / 通义千问 / Kimi 官方 API，或**任意 OpenAI 兼容端点**（自建 OneAPI / New API、OpenRouter、其他中转站均可），设置页可改 Base URL
- 封面/配图的生图端点（`IMAGE_API_BASE`）同样可指向任意 OpenAI 兼容服务
- 代码中出现的默认地址只是「开箱能跑」的示例占位，随时可换，欢迎按自己的供应商偏好接入
- 在线演示站同样不为任何服务背书

## 技术要点

- **Next.js 16 App Router 全栈**，无独立后端；前端不直连数据库，读写全走 server route
- **部署形态**：`@opennextjs/cloudflare` 把整个应用打成单个 Worker；页面与 API 同进程，静态资源走 Workers Static Assets；`worker.ts` 在 OpenNext 的 fetch 之外补了一个 `scheduled` 处理器接每日定时采集
- **安全模型**：4 张表 RLS 全开、仅 `ms_app` 角色有策略；服务端经 Hyperdrive → transaction pooler 直连；全站 HMAC 签名 cookie 门禁（可选，不配 `ACCESS_PASSWORD` 即公开模式，此时配置接口不回显密钥）；`READ_ONLY=1` 时 middleware 拒绝一切写请求；采集/生成侧 URL 均过 SSRF 校验
- **连接自愈**：针对 pooler 挂死场景的三层防御（超时→重建连接池→重试），见 `lib/db.ts` / `lib/queries.ts`
- **提示词单一事实源**：全部写作规则在 `prompts/` 目录 md 文件，运行时可被数据库覆盖值热替换
- **结构化输出降级**：部分模型 `generateObject` 概率性退化（实测记录在 `docs/architecture.md`），注册表按模型自动降级并在 UI 明示

## 目录结构

```
app/          页面 + API 路由（含 /f/[...key] 图片直链）
lib/          核心逻辑（采集/生成/封面/配图/排版渲染/连接自愈/对象存储）
components/   业务组件 + 设置页域卡片
prompts/      写作规则与系统提示词（单一事实源）
supabase/     建表 SQL
worker.ts     Cloudflare Workers 入口（包 OpenNext 的 fetch + 定时任务）
wrangler.jsonc  Workers 配置（绑定、Cron Trigger、静态资源）
docs/         子系统文档
```

## License

[MIT](LICENSE)
