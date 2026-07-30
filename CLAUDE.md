# media-studio — 自媒体「素材→稿件」广播工作台（开源版）

带密码门禁的全栈工作台：**RSS 素材采集 → 选题 → 扩写深化 → 公众号成稿（正文+配图+封面）→ 小红书/抖音长文一键导出**。

Next.js 16 + React 19 + Tailwind v4，Supabase 4 张 `ms_` 前缀表，多家 LLM 引擎可切换。

## 文档索引（改代码前按需读）
| 文档 | 什么时候读 |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | 技术栈、`ms_app` 直连 + 连接自愈、4 张表、门禁、环境变量 |
| [docs/writing-styles.md](docs/writing-styles.md) | 风格注册表、净化器、防编造经历 |
| [docs/wechat-assets.md](docs/wechat-assets.md) | 配图、封面生图、排版主题、滚动同步、AI 标题 |
| [docs/xiaohongshu-copy.md](docs/xiaohongshu-copy.md) | 一键复制到小红书长文：schema 白名单、AI 高亮、图片为什么带不过去 |
| [docs/douyin-copy.md](docs/douyin-copy.md) | 一键复制到抖音长文：三段式导出、正文纯文本转换、AI 生成 30 字摘要 |
| [docs/zhihu-copy.md](docs/zhihu-copy.md) | 一键复制到知乎专栏：裸语义化 HTML、与推特那份的差异（图片保留、代码块保留） |
| [docs/twitter-copy.md](docs/twitter-copy.md) | 一键复制到推特长篇 X Articles：Draft.js 实测 schema、section 外壳为什么会把结构压塌、图片带不过去 |
| [docs/ingestion.md](docs/ingestion.md) | RSS 采集、每日 cron |
| [docs/roadmap.md](docs/roadmap.md) | 待办与已砍项（别重提被砍的想法） |
| `CHANGELOG.md` | 逐次改动的历史 |

## 六条硬性约定（违反了必然出事）
1. **提示词从 `getPrompt(id)` 取**，不许写死在调用点（注册表 `lib/prompt-store.ts`，`/prompts` 页可视化改，存 DB 即生效）
2. **出稿的 generateObject 一律走 `styledGenerateObject`**（`lib/styled-generate.ts`），风格注入与成稿净化由它统一收口，不许在调用点手工织入
3. **产出公众号稿的路径落库后必须调 `finalizeWechatDraft()`**（`lib/finalize-wechat.ts`），配图 + 封面一条龙不许各写一份
4. **查询函数保持 `guardRead` / `guardWrite` 包裹**（`lib/queries.ts`），这是 pooler 挂死的救命结构
5. **虚构红线**：模型不许编造第一人称经历。用户填了「真实经历」栏才织进正文，没填就走现象解读型骨架
6. **每次功能改动，在 `CHANGELOG.md` 顶部追加条目**：日期 + 改了什么 + 为什么 + 涉及文件

## 目录结构
```
app/            页面 + API 路由（force-dynamic）
  api/          auth · materials · topics · drafts · generate · rewrite · suggest-angle
                cover · images · ingest（手动采集） · cron（daily 每日编排 + cleanup 手动清理） · prompts · config
lib/            db · auth · queries · llm · prompt-store · prompts · generate · styled-generate · styles
                finalize-wechat · draft-tasks（前端收尾任务唯一实现） · illustrate · cover · image-search
                rss · rss-presets（预置订阅源库） · ingest · cleanup · wemark/
components/     UI kit(ui/*) + settings/（设置页域卡片）+ 业务组件（SiteHeader/InboxClient/TopicsBoard/TopicDetail/DraftEditor/CoverGenerator...）
prompts/        ★写作规则唯一事实源
                anti-ai-rules.md · pipeline/ · platforms/
                system/（系统提示词，含 system/cover/ 封面风格、system/xhs/ 小红书指令、system/douyin/）
scripts/        query · cleanup · convert-wenyan-themes
supabase/migrations/   docs/   hooks/
```

## 常用命令
```bash
npm run dev                      # 本地开发
npm run build                    # 生产构建
npm run --silent query -- material <id> | topic <id> | search "<q>" [source] [limit]
npm run cleanup                  # 手动清理超期素材与缓存（dry-run 见脚本参数）
```

## 文档/注释规范
CLAUDE.md、README.md、代码注释全部中文；标识符（变量/函数/类名）保持英文。
