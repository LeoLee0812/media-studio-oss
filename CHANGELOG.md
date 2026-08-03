# 更新日志

维护规则：每次功能改动在本文件顶部追加条目——日期 + 改了什么 + 为什么 + 涉及文件。

## 2026-08-03 正文编辑区支持粘贴 / 拖拽图片

- **改了什么**：稿件页正文 textarea 接管 `paste` 与 `drop` 事件——截图直接 ⌘V，或把图片文件拖进来，
  就在光标处插入一行占位「上传中…」，图片压缩后传 Vercel Blob 换公网直链，再把占位替换成
  `![粘贴图片](直链)`，右侧排版预览随即加载出图。多张并发上传，一张失败只撤掉它自己的占位。
- **为什么原来不行**：textarea 是纯文本控件，浏览器对「粘贴一张图」本身不做任何事——剪贴板里的
  图片数据在 `clipboardData.files/items` 里，不主动去取就等于没发生。这不是 bug，是必须自己写的功能。
- **为什么必须换成外链而不是 base64 内嵌**（与 AI 配图链路同一条理由）：公众号编辑器粘贴富文本时
  只会抓取外链 `<img>` 转存，base64 粘不过去；而且 base64 写进 `ms_drafts.content` 会让正文涨到 MB 级。
- **上传前先压**：Retina 截图动辄 5-10MB，超过 Vercel Serverless 4.5MB 请求体上限。浏览器里 canvas
  等比缩到最长边 1920 + JPEG 0.9；小于 800KB 的图原样传（不把干净 PNG 白白转 JPEG，截图文字最怕二次压缩）。
- **只读演示站**：`/api/images/upload` 是 POST，`READ_ONLY=1` 下由 middleware 统一 403，
  前端照常显示上传失败提示——与其它写操作行为一致，不需要单独兜底。
- **依赖**：上传落 Vercel Blob，自部署需要在 Vercel 项目里开通 Blob 存储（`BLOB_READ_WRITE_TOKEN`），
  与 AI 配图链路共用同一份配置。
- **涉及文件**：`app/api/images/upload/route.ts`（新）、`lib/paste-image.ts`（新）、`components/DraftEditor.tsx`

---

## 2026-08-03 配图与封面预设化 + 素材流就地采集

- **改了什么（一）配图与封面预设**：设置页新增「配图与封面预设」卡片（`components/settings/ImagePresetCard.tsx`），
  一次性预设「文内配图默认方式（图库搜图 / AI 生成图解 / 不配图）+ AI 图解风格与张数 + 封面默认风格」，
  生文流水线 `finalizeWechatDraft()` 出稿时直接照办：预设 AI 生图就自动拆认知锚点现生现画（张数由预设收紧，默认 2 张），
  封面 `meta.cover` 也按预设风格落库，前端随后自动生图。
- **为什么**：原来这两个选择都发生在「稿件已经生成之后」——回稿件页手动点「AI 配图 / AI 生成配图」、
  再在封面区挑一次风格。风格其实是稳定偏好，不该每篇重挑一遍。现在预设一次，之后全自动；
  稿件页的逐篇临时切换原样保留（AI 配图下拉框的初始选中项也跟随预设）。
- **顺带收口**：AI 配图的整篇编排从路由搬进 `lib/illustrate-ai.ts` 的 `illustrateArticleWithAi()`，
  稿件页路由与生文流水线共用同一份实现；风格常量抽到纯数据文件 `lib/illustrate-styles.ts`，
  消掉 DraftEditor 里那份手抄副本（与 `lib/cover-styles.ts` 同款做法）。
  前端收尾 `runPostDraftTasks` 按实际产出分派下载：AI 图解落「AI配图」子目录，图库配图落「子图」。
- **成本提醒**：AI 生图一张真金白银、每张 30-60 秒，张数上限仍是 4；卡片里对慢和贵都写明了。
- **改了什么（二）素材流就地采集**：素材流页和仪表盘加上 `SourceSyncButtons`，直接点「拉取 RSS」。
  组件与具体源无关：`SOURCES` 里加一项 + 补一个 `/api/ingest/<id>` 路由就能接新源，多源时自动多出
  一个「全部拉取」按钮并行跑一遍（各源打的是互不相干的外部接口、各自独立的函数实例与连接池，
  串行只是白等成倍的时间）。
- **为什么**：RSS 手动拉取此前只在设置页有入口。采集是日常动作，不该藏在设置里。
- **涉及文件**：`lib/illustrate-styles.ts`（新）、`lib/illustrate-ai.ts`、`lib/finalize-wechat.ts`、
  `lib/config.ts`、`lib/draft-tasks.ts`、`app/api/config/route.ts`、`app/api/drafts/[id]/illustrate-ai/route.ts`、
  `components/settings/ImagePresetCard.tsx`（新）、`components/SettingsClient.tsx`、`app/settings/page.tsx`、
  `components/DraftEditor.tsx`、`app/drafts/[id]/page.tsx`、`components/SourceSyncButtons.tsx`（新）、
  `app/inbox/page.tsx`、`app/page.tsx`

---

## 2026-07-31 素材流支持本地文件夹批量导入（Obsidian vault）

- **改了什么**：「添加素材」弹窗拆成「手动录入 / 批量导入」两个标签页。批量导入支持三种投喂：
  拖拽文件夹（`webkitGetAsEntry()` 递归展开子目录）、`<input webkitdirectory>` 选文件夹、多选文件。
  文件在浏览器里读取解析成素材条目（frontmatter 的 title/tags/date、正文一级标题、行内 `#tag`、
  首层目录名当板块），预览列表可逐条剔除，再分批（每批 50 条）POST 到新接口 `/api/materials/bulk`。
- **去重**：`dedupe_key = local:<vault 名>/<库内相对路径>`，同一份 vault 重复导入自动跳过、不覆盖已有素材
  （素材的板块/状态可能已被手工改过）。结果按「新增/跳过/失败」汇总。
- **只收文本笔记**：`.md/.markdown/.mdx/.txt`，跳过 `.obsidian`、`.git`、`node_modules` 等目录与隐藏文件；
  单次 ≤2000 个文件，单篇正文超 20000 字截断。跳过数量在界面上明示，免得以为漏导了。
- **为什么**：RSS 给的是行业动态，个人知识库才是内容辨识度的来源。原先只能一条条手动录，
  或者让 Agent 写一次性脚本灌库——对着几十上百篇 Obsidian 笔记不现实。
- **隐私边界**：文件只在浏览器本地解析，只发往自己那份部署；公开演示站 `READ_ONLY=1`，
  写接口一律 403，导不进去（要用就自部署）。
- **顺带**：`lib/db.ts` 连本机 Postgres（localhost/127.0.0.1）时自动关掉 `ssl:require`——
  本机库默认不开 TLS，否则本地开发根本连不上；远端连接一律仍走 require。
- **涉及文件**：`lib/vault-import.ts`（新增）、`components/BulkImportPanel.tsx`（新增）、
  `app/api/materials/bulk/route.ts`（新增）、`docs/local-import.md`（新增）、
  `components/InboxClient.tsx`、`lib/types.ts`、`lib/db.ts`、`components/Landing.tsx`、`README.md`

## 2026-07-30 新增只读模式：公开演示站全站禁写

- **改了什么**：新增 `lib/read-only.ts` 的 `isReadOnly()`（开关是 env `READ_ONLY=1`）。开启后
  ① middleware 拒绝一切非 GET/HEAD/OPTIONS 请求（403 + 统一文案），排在门禁判断之前——只读跟登不登录无关；
  ② `/api/auth/*` 豁免（只读 + 有密码门是合法组合，拦了没人能登录，且它只写 cookie 不动业务数据）；
  ③ `/api/cron/daily` 是全站唯一用 GET 触发写库的入口，在路由内部判断只读并返回 `{skipped:true}`，
     用 200 而不是 403，免得 Vercel 定时任务天天记一次失败；
  ④ 设置页整页替换成说明卡片——那一屏能改文案/生图引擎的 Base URL，是现成的 SSRF 入口，
     服务端已经拦死，UI 上再整个拿掉，免得访客对着填不进去的输入框瞎试。
- **没有顶栏提示条**：一开始加了条常驻横幅写「新增/修改/删除都会被拒绝」，读着像在防贼，
  访客第一眼看到的不该是这个。整条删掉；被拦时的 403 文案也收敛成中性的一句
  「演示站为只读模式，暂不支持修改。」
- **为什么**：演示站改成公开免登录之后，任何人都能改设置、删稿件、写脏数据。
  只读模式让它退化成一个纯展示站：内容固定、谁也改不了，想动手就自己部署。
- **涉及文件**：`lib/read-only.ts`（新增）、`middleware.ts`、`app/api/cron/daily/route.ts`、
  `app/settings/page.tsx`、
  `.env.example`、`docs/architecture.md`、`README.md`

## 2026-07-30 密码门禁改为可选：不配 ACCESS_PASSWORD 就是公开站

- **改了什么**：`isGateEnabled()`（`lib/auth.ts`）判断有没有配 `ACCESS_PASSWORD`——没配就是「公开模式」，
  middleware 全部放行、`/login` 直接跳回落地页、顶栏不再渲染「退出登录」。
- **为什么**：本仓库的在线演示站是给人随便点的公开站，还要先输密码纯属多余门槛；
  自部署的人配上 `ACCESS_PASSWORD` 就照旧有门，两种形态一套代码。
- **踩到的坑（必须一起改）**：`app/layout.tsx` / `app/page.tsx` / `app/home/page.tsx` 原本直接用
  `verifyToken(cookie)` 判断登录态。公开模式下没有 cookie，光放开 middleware 会让**导航栏整个消失、
  `/` 被落地页顶掉仪表盘**。统一改走 `hasWorkspaceAccess()`（公开模式恒真）。
- **安全代偿**：`/api/config` 的 GET 原本明文回传所有 API key（给设置页做「点击可见」用），
  前提是「站有门禁」。公开模式下这等于把密钥送给所有访客——现在按 `openMode` 把
  `llmProviders[].apiKey` / `imageApiKey` / `pexelsApiKey` / `pixabayApiKey` 一律抹成空串，
  只回 `*Enabled` 布尔；写入不受影响（设置页照样能填新 key，只是不回显已存值）。
  响应体新增 `openMode` 字段供前端提示。
- **涉及文件**：`lib/auth.ts`、`middleware.ts`、`app/layout.tsx`、`app/page.tsx`、`app/home/page.tsx`、
  `components/SiteHeader.tsx`、`app/api/config/route.ts`、`.env.example`、`docs/architecture.md`、`README.md`

## 2026-07-30 README 改版：OpenFDE 获客定位 + 按赛道挑订阅源

- **改了什么**：README 新增「这个项目为什么存在：自媒体是获客的前置环节」（OpenFDE 社区背景、
  内容→私域→FDE 客户的完整链路）与「按你的赛道挑订阅源」（让 AI Agent 代查并验证 RSS 源的
  现成提示词、RSSHub 兜底、把自己的知识库变成素材的两条路径）；在线体验地址换成
  <https://media-studio-oss.saveme505.help>（国内可访问），vercel.app 降为备用；
  功能清单补上知乎专栏 / 推特长篇 / 排版可写模式，封面风格 6 套改 7 套。
- **为什么**：原 README 只讲「这是什么工具」，没讲「为什么值得用它做自媒体」；
  而素材源照抄默认值是新用户最容易走偏的一步，得明确告诉人按自己赛道配。
- **涉及文件**：`README.md`

## 2026-07-30 同步上游：公众号「可写模式」+「知乎专栏」一键复制 + 封面新风格

- **公众号排版预览加「可写模式」**：右侧预览从纯只读变成可编辑视图——点任意段落原位展开该段
  Markdown 编辑框，悬停出「上移 / 下移 / 下方插入 / 删除」工具条，标题可点改，另加「固化重排」
  把预览的呼吸感重排写进正文。改动 400ms 防抖写回同一份 `content` 状态，左侧编辑区、未保存标记、
  ⌘S 保存、AI 链路全都自动跟上。
  实现要点：`lib/wemark/renderer.ts` 新增 `renderMarkdownBlocks()`——`marked.lexer` 切顶层 token，
  逐 token parser 后套 `data-md-block` 外壳走同一条 transform 流水线，块与 Markdown 源严格一一对应；
  块源码用顺序 `indexOf` 定位字符区间，定位失败或正文刚变过就降级只读，绝不写错位置。
  复制到公众号 / 小红书 / 推特仍走原来的整段渲染。另修两处：误缩进 4 空格的中文段落不再被当成
  缩进代码块（只改渲染，块 raw 仍是原文）；块悬停工具条加深。
- **复制那排加「知乎专栏」按钮**：点了即刻把稿件写成裸语义化 HTML 进剪贴板，去知乎「写文章」直接粘。
  纯前端确定性转换，不碰 AI 也不碰接口。与推特长篇那份的两处关键差异：① 图片保留 `<img>`（知乎粘贴
  会自动转存，与公众号同机制）；② 代码块 / 分隔线 / 表格知乎都有块型，`<pre><code>`/`<hr>`/`<table>`
  原样保留。标题 `##` → `h2`、`###`+ → `h3`（知乎只有两级标题）；属性只留 `a[href]` 与 `img[src|alt]`。
- **头部按钮行不再溢出卡片**：加了可写模式两个开关后一行装不下六个复制按钮，两组都开 `flex-wrap`，
  复制组 `ml-auto` 靠右、挤不下折行。
- **封面新增「图标展台风」**：浅灰摄影棚背景 + 3D 陶瓷质感图标摆在高低错落展示台上 + 单一强调色
  + 极粗黑体大字，走现有「锚点直生」链路，默认 4:3。
- **未同步的上游改动**：上游同期还修了「计划发布」排期框显示成 UTC 的问题；开源版没有排期功能
  （`scheduledAt` 已在脱敏时移除），该修复不适用，跳过。
- **涉及文件**：`components/WechatWriteView.tsx`、`lib/zhihu-article.ts`、`docs/zhihu-copy.md`、
  `prompts/system/cover/styles/icon-pedestal.md`（新增），`components/WechatStudio.tsx`、
  `components/DraftEditor.tsx`、`lib/wemark/renderer.ts`、`lib/cover-styles.ts`、`lib/prompt-store.ts`、
  `docs/wechat-assets.md`、`CLAUDE.md`、`README.md`

## 2026-07-29 新增「推特长篇」一键复制到 X Articles + 修中文加粗漏 `**`

- **推特长篇**：稿件页排版预览区新增「推特长篇」按钮，把稿子转成 X 文章编辑器吃得下的
  裸语义化 HTML 写进剪贴板；新增 `lib/twitter-article.ts` 与 `docs/twitter-copy.md`。
  X 的文章编辑器是 Draft.js，公众号那份满是 `<section style>` 的 HTML 粘过去会被
  压塌成一个大段落，所以必须单独渲染一套。实测规则见文档。
- **中文加粗补丁**：新增 `lib/marked-cjk.ts`。CommonMark 的强调 flanking 规则只认
  ASCII 标点，`一个叫**中缝核（Raphe Nuclei）**的地方` 这类紧邻中文/全角标点的加粗
  两头都开合不了，`**` 会原样漏给读者。注册一个优先级更高的 inline extension，用
  「只看空白、不看标点」的宽松规则接管 `***`/`**`/`~~`，产出标准 em/strong/del token，
  下游排版、小红书「加粗→高亮」、推特长篇全部照常吃到。公众号 / 小红书 / 推特长篇
  三条渲染链路都挂上了；抖音走纯文本正则，本来就没这个问题，不动。
- **涉及文件**：`lib/twitter-article.ts`、`lib/marked-cjk.ts`、`docs/twitter-copy.md`（新增），
  `components/WechatStudio.tsx`、`lib/xhs.ts`、`lib/wemark/renderer.ts`、`CLAUDE.md`。

## 2026-07-28 第四引擎中立化：「云雾 API」→「聚合中转站（OpenAI 兼容）」+ Base URL 可配

开源项目不该内置像广告的第三方默认值——yunwu.ai 降级为「可替换的默认示例」，任何 OpenAI 兼容端点均可接入：

- **引擎改名**：provider id `yunwu` → `relay`，配置字段 `yunwuApiKey`/`yunwuModel` → `relayApiKey`/`relayModel`，env `YUNWU_API_KEY`/`YUNWU_MODEL` → `RELAY_API_KEY`/`RELAY_MODEL`（全新开源项目，无存量配置兼容问题）；UI 文案与注册表说明改为供应商中立表述
- **Base URL 可配置**：新增 `AppConfig.relayBaseUrl` + env `RELAY_BASE_URL`（`resolveProviderBaseUrl`，DB > env > 默认示例，SSRF 校验后落库）；生效值穿透 `buildModel` 与 `fetchProviderModels`，设置页 relay 引擎下显示「中转站 Base URL」输入框，「获取模型」「测试连接」都按待保存值优先测当前端点；deepseek/qwen/kimi 仍固定官方地址
- **无广告立场落文档**：README 新增「第三方服务与中立声明」小节；docs/architecture.md 四引擎表与 env 清单改写 + 中立声明；docs/ingestion.md、.env.example、生图设置卡说明同步中立表述
- 涉及：`lib/{llm-providers,config,llm,llm-models,illustrate-ai,illustrate-server}.ts`、`app/api/config/{route,models/route,test/route}.ts`、`app/settings/page.tsx`、`components/SettingsClient.tsx`、`components/settings/{LlmEngineCard,ImageEngineCard}.tsx`、`README.md`、`docs/{architecture,ingestion,wechat-assets}.md`、`.env.example`

## 2026-07-28 README 改版 + 在线演示站

- README 新增三张界面截图（docs/screenshots/）、在线演示入口，安装改为两种方式：「AI 编程代理一键安装」（整段提示词复制给 Claude Code/Codex 即可代装）+ 可折叠的手动安装
- 演示站部署在 Vercel（media-studio-oss.vercel.app），数据库用独立 schema + 独立只读界限角色，与任何其他数据完全隔离

## 2026-07-28 板块泛化为自由分类 + 预置源库接入设置页 + 移除个人人设

开源版收尾三件事：

- **板块（Pillar）从三值枚举泛化为自由字符串**：用户可以任意命名素材分类（如「AI 资讯」「科学认知」），空值即未分类。删除 `PILLAR_LABELS` 常量；各处筛选下拉改为从当前列表数据收集非空板块动态生成；API 侧（materials/rewrite/config）改为接受 trim 后 1-30 字符的任意字符串，RSS 源的空板块归一化为「未分类」。涉及 `lib/types.ts`、`lib/config.ts`、`lib/queries.ts`、`app/api/{config,materials,rewrite,suggest-angle}/route.ts`、`app/{page,drafts/page,rewrite/page}.tsx`、`components/{InboxClient,DraftsList,TopicsBoard,TopicDetail}.tsx`
- **移除按板块绑定的个人人设**：删除 `prompts/personas/` 整个目录与 `lib/prompts.ts` 的 `getPersona()`；生成链路只保留选题级 `topic.persona` 自由文本（`lib/generate.ts` 的 `personaSystem()`）；洗稿页删掉写死的三段人设，「板块」选择器改为自由文本输入；`prompts/pipeline/expand.md` 与 `docs/ingestion.md` 的人设/固定板块表述改为通用表述
- **预置 RSS 源库接入设置页**：`components/settings/RssFeedsCard.tsx` 新增可折叠「预置源库」区块，按分组展示 `lib/rss-presets.ts` 的 6 组 18 个源，支持逐条「添加」与「整组添加」（已存在的置灰），添加后仍走「保存源列表」统一落库；每行源的板块输入改为自由文本 + `<datalist>` 联想（候选 = 预置分组名 + 已有分类名）

## 2026-07-28 开源首发

从私有版本 fork 并重构为开源版：

- 素材源收敛为 **RSS 订阅 + 手动录入**，内置多组分类预置源，支持自定义添加任意 RSS/Atom 源
- 输出形态收敛为 **公众号成稿 + 小红书/抖音长文一键导出**
- 移除私有部署耦合（硬编码域名、第三方服务凭据、个人数据源导入）
- 修复：素材 URL 服务端抓取的 SSRF 校验、洗稿去重键并发冲突、稿件平台白名单校验、若干查询未走连接自愈包装
