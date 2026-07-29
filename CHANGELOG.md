# 更新日志

维护规则：每次功能改动在本文件顶部追加条目——日期 + 改了什么 + 为什么 + 涉及文件。

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
