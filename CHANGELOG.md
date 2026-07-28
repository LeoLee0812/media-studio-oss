# 更新日志

维护规则：每次功能改动在本文件顶部追加条目——日期 + 改了什么 + 为什么 + 涉及文件。

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
