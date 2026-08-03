# 公众号成稿资产：配图 · 封面 · 排版预览

## 收尾共用收口 `lib/finalize-wechat.ts`（2026-07-14 起，硬性约定）
所有产出公众号稿的 API 路径（`/api/generate`、`/api/rewrite`）落库后**必须调 `finalizeWechatDraft()`**，不许在调用点各写一份——洗稿曾因各写一份漏掉这步，导致没配图没封面。

前端一条龙（原图备份 + 封面生图保存）：选题页在 `TopicDetail`，洗稿页在 `app/rewrite/page.tsx` 的 `autoAssets()`。

## AI 配图（2026-07-13 起）
核心流水线 `lib/illustrate-server.ts` 的 `illustrateArticle`：
LLM 按编号段落挑 2-4 个插图点（`illustrate_system`）→ Pexels / Pixabay 并发竞速搜图，谁先命中用谁（`lib/image-search.ts`，Promise.any 语义，快的那家失败或没结果时自然等慢的那家）→ markdown 图片插回正文。

- `/api/generate` 生成公众号正文时自动跑（清单存 `meta.illustrations`，失败不阻断）
- `/api/drafts/[id]/illustrate` 供改稿后重配（不落库，前端确认后保存）

### 落地与复制（2026-07-13 调研结论，别改回占位框方案）
公众号后台编辑器粘贴富文本时**会自动抓取外链 `<img>` 转存到 mmbiz.qpic.cn**（mdnice / doocs 全靠此机制），成功条件是 https + 无防盗链 + 体积适中，Pexels / Pixabay 都满足。**base64 内嵌反而有粘贴失败反馈，不要用。**

因此「复制到公众号」直接携带 `<img>` 原样粘贴；原图仍经 `/api/images/proxy`（域名白名单防 SSRF）备份到封面绑定文件夹（文件名规则见 `lib/illustrate.ts` 的 `illustrationFilename`，前后端共用），个别转存失败时用本地同名原图手动替换。

## AI 生成配图（2026-07-21 起，与图库搜图**并存**的第二条配图链路，迁移自 izscc/cc2image）
不搜图，现生现画知识图解。跟上面那条的根本差别在**选点逻辑**：图库链路是「均匀分布给视觉呼吸感」，
这条走 cc2image 的**认知锚点拆图**——优先抓核心判断、认知断点、输入输出闭环、分流判断、前后对比、
承接路径、常见坑，配图因此带信息价值而不只是装饰。

流水线 `lib/illustrate-ai.ts`：`planAiIllustrationAnchors()` 按 `illustrate_ai_anchor_system` 拆锚点
（`generateObject`，字段 after / coreIdea / visualAnchor / elements / characterAction / caption，**最多 4 张**）
→ 按风格的确定性模板拼提示词 + 该风格锚点 → **严格串行**逐张调 gpt-image-2（不并发，别放大瞬时成本）
→ 图片以 `data:` URI 插回正文并落 `meta.aiIllustrations`。

- 两套风格：手绘知识风 `handdrawn_knowledge_card`、怪诞小人风 `quirky_doodle_character_flow`
  （后者适合 AI 工作流 / 系统流程 / 方法论拆解类文章）。锚点文本译自 cc2image 的 `STYLE_ANCHORS`，
  **只保留材质/配色/负面清单，不带封面专属的刊头与底部留白带规则**
- 整篇编排收口在 `illustrateArticleWithAi()`（`lib/illustrate-ai.ts`）：稿件页路由与生文流水线
  共用同一份，不许在调用点各抄一遍
- 两个入口：① 稿件页「AI 生成配图（知识图解，现生现画）」卡片手动触发，接口
  `POST /api/drafts/[id]/illustrate-ai`；② 设置页把「文内配图默认方式」预设成 AI 生图后，
  生文流水线出稿时自动跑（见下面「配图与封面预设」）。张数上限恒为 4，自动链路默认 2 张
- 图片不内嵌 base64，一律传 Vercel Blob 换公网直链再插回正文（`uploadIllustrationToBlob()`）：
  公众号只抓外链 `<img>` 转存，且 base64 会把 `ms_drafts.content` 撑到 MB 级
- 本地保存走 `downloadAiIllustrations()` → `<笔记名>/AI配图/`（AI 图没有可代理的外部 URL，不走 `/api/images/proxy`）

## 配图与封面预设（2026-08-03 起）
设置页「配图与封面预设」卡片（`components/settings/ImagePresetCard.tsx`）预设三件事：
**文内配图默认方式**（`search` 图库搜图 / `ai` AI 生图解 / `off` 不配图）、**AI 图解风格与张数**、
**封面默认风格**。存 `app_config`，服务端由 `resolveImagePreset()`（`lib/config.ts`）解析，脏值一律
回落默认，不让坏配置打断出稿。

- `finalizeWechatDraft()` 按预设分流：`ai` 走 `illustrateArticleWithAi()`（张数取预设值）、
  `search` 走图库链路、`off` 只记一条 warning。封面 `meta.cover` 直接落预设风格
- 语义推荐 `recommendCoverStyles()` 不再决定落库值，只在稿件页作为切换建议展示——风格是稳定
  偏好，逐篇由关键词打分抖来抖去会让一批稿子的封面不成系列
- 风格常量在纯数据文件 `lib/illustrate-styles.ts`（服务端 / 客户端共用单一事实源，与
  `lib/cover-styles.ts` 同款做法），别再在组件里抄副本
- 稿件页的逐篇临时切换原样保留，AI 配图下拉框的初始选中项跟随预设

## 正文粘贴 / 拖拽图片（2026-08-03 起）
稿件页正文 textarea 接管 `paste` 与 `drop`（`lib/paste-image.ts` + `components/DraftEditor.tsx`）：
截图 ⌘V 或拖入图片文件 → 光标处插一行占位「上传中…」→ 浏览器内压缩 → `POST /api/images/upload`
传 Vercel Blob → 占位替换成 `![粘贴图片](直链)`。多张并发，一张失败只撤掉它自己的占位并报错。

- textarea 是纯文本控件，浏览器对「粘贴一张图」本身不做任何事（数据在 `clipboardData.files/items` 里），
  这不是 bug，是必须自己写的功能
- **上传前先压**：Retina 截图动辄 5-10MB，超过 Serverless 4.5MB 请求体上限。canvas 等比缩到最长边
  1920 + JPEG 0.9；小于 800KB 的原样传（不把干净 PNG 白白转 JPEG，截图文字最怕二次压缩）
- 换外链而非 base64 内嵌，理由与 AI 配图链路同一条
- 需要 Vercel Blob 凭据（`BLOB_READ_WRITE_TOKEN`）；只读演示站下该接口由 middleware 统一 403

## 生成收尾三路并行（2026-07-14 起）
正文落库后，选题页/洗稿页把三个收尾任务 `Promise.allSettled` **并行**跑（完成时间差异大，谁先完成谁先亮）：
① 配图原图备份（几秒）② 封面生图（1-2 分钟）③ 小红书高亮预热（30-100 秒，见 `docs/xiaohongshu-copy.md`）。
稿件页 `CoverGenerator` 对「有 `meta.cover.prompt` 但无 `generatedAt`」的稿子**自动轮询**（8 秒一次、最多 5 分钟）
直到封面出图自动显示——修掉「正文出来了还要手动刷新才能看到封面」。

## AI 封面图（2026-07-12 起「正文 + 封面」同步生成；2026-07-19 起默认「模板直生」）
主流程：选题页生成 / 快速洗稿出公众号稿 → 服务端在 `meta.cover` 标记生成方式（模板直生只记 `{mode:"template", style, ratio}`；无模板时回落旧提示词链路、随稿写好绘图提示词）→ 前端自动调 `/api/cover/image {draftId}` 生图 → 图片 base64 落 `ms_sync_state.cover_image:<draftId>`（**不进 ms_drafts**）→ 前端裁剪后自动保存本地。

- **模板直生（2026-07-19 起）**：不走文案引擎——把该风格的模板参考图（`prompts/system/cover/templates/<风格key>/`，最多 4 张，加图即丢文件重部署）连同固定指令（提示词中心 `cover_template_instruction`）+ **该风格的「风格定义」**直接发给 GPT Image 的 **`/images/edits`**（multipart，`image[]` 多文件，默认示例中转端点已实测支持），标题作画面大字逐字渲染，画面由图像模型照模板自己构思；稿件页可填「补充要求」。硬约束：**底部 10% 干净留白带（无字、无图画，深浅不限）**。风格定义在这条链路上当「文字缰绳」，防模型顺着参考图的题材跑偏。模板可用性走 `/api/cover/templates`。

- **锚点直生（2026-07-21 起，无模板参考图时的默认链路，迁移自 izscc/cc2image）**：风格不靠参考图、靠文字立起来。两步——① 文案引擎按 `cover_spec_system` 把稿件拆成五个结构化字段（`headline` / `deck` / `tags` / `metaphor` / `elements`，`generateObject`）；② 字段填进通用版式骨架 `cover_anchor_layout`（无刊头、标题唯一且为主视觉、宽幅左右 45/55 分栏、底部 10% 干净留白带），再拼上该风格的风格定义 + 裁剪安全区 → `/images/generations`。比旧提示词链路稳的地方在于**版式由代码固定、模型只填字段**，出问题能分清是字段拆歪还是风格描述不对；拆出的字段随图回传并落 `meta.cover.spec`，稿件页会回显。
  **模板图从此是可选增强**：往 `templates/<key>/` 丢图，同一套风格自动从锚点直生升级成模板直生，风格定义不用动。

  **刊头已取消（2026-07-21，最终决定）**：封面**一律不生成刊头**——不许出现任何刊名、博主名、账号名、logo、水印，参考图里的博主名同样不许照抄；不含名字的杂志刊眼装饰（细规线、期号标签、页码、条码）可以留。
  起因是锚点直生里中文小字刊头三次验收一次都没渲染出来（第一次被顶部裁剪切掉半行，后两次巨型标题顶满安全带、模型直接省略刊头），加固两轮措辞（方位词一律指裁剪安全带 → 顶部预留刊头专属行）均无效——GPT Image 在巨型标题在场时会稳定丢弃中文小字刊头。与其继续跟模型较劲，直接取消刊头，画面反而更干净。
  规则落在三份提示词里，改的时候别漏：`cover-anchor-layout.md`（锚点直生）、`cover-template-instruction.md`（模板直生）、`cover-viral-tech.md`（旧提示词链路）。

- **本地保存**：File System Access API 绑定文件夹（句柄存 IndexedDB，`lib/cover-client.ts`），未绑定则退回浏览器下载。`<a download>` 无法指定子文件夹是浏览器安全策略，别再尝试
- **目录结构（2026-07-14 起按笔记分文件夹）**：`绑定文件夹/<笔记名>/封面-xxx.png` + `<笔记名>/子图/配图N-xxx.jpg`。子目录由 `saveImageBlob(blob, filename, subdirs)` 用 `getDirectoryHandle(…, {create:true})` 逐级创建；笔记名经 `sanitizeFsName` 安全化。浏览器下载兜底建不了目录，把路径拍平进文件名
- **风格库 6 套（2026-07-21 重整）**：注册表在 `lib/cover-styles.ts`（**纯数据 + 纯函数，服务端与客户端组件共用同一份**，历史上「lib/cover.ts 与 CoverGenerator.tsx 各抄一份、改一处漏一处」的坑就此消掉）。一套风格 = 一份「风格定义」提示词（描述气质/材质/配色/构图特色 + 负面清单，两条直生链路共用）+ 元数据（默认比例、适合选题、推荐关键词）——
  ① 爆款科技风 `viral_tech`（默认）：深色高对比 + 霓虹辉光 + 超厚描边中文大字 + glossy 3D 元素；
  ② 黑白系统风 `mono_system`（迁移自 cc2image）：黑白高对比 + 巨型粗体字 + 网格/条码/REF 编号/01-04 流程导航，方法论手册与 SOP 封面感；
  ③ 语义字体风 `material_type`（cc2image）：标题字按语义做成真实材质（木/石/蜂蜜/金属/玻璃/火），干净棚拍背景；
  ④ 人群造字风 `crowd_type`（cc2image）：高空俯视 + 上百微缩真人排成巨大文字/图形，财经与社会议题封面；
  ⑤ 玻璃气泡风 `glass_blob`（cc2image）：半透明液态玻璃体 + 低饱和渐变光晕，文字与形体前后穿插；
  ⑥ 时间微缩风 `timeline_mini`（cc2image）：45° 等距俯视微缩沙盘，横向 4-6 段展台展示演化过程。
  **2026-07-21 下线**：电影实拍字效风 `cinematic`、花叔海报风 `huashu`（都没有模板图、也没人用）。老稿件 meta 里的旧风格值（cinematic / huashu / 不限 / 极简…）由 `resolveCoverStyle` 统一回落到爆款科技风。
  **cc2image 锚点搬过来必须做的适配**（原文直接抄会出事）：补底部 10% 留白带、竖版版式改写成宽幅左右分栏、负面清单**必须按风格独立**（cc2image 里大量「不要 3D / 不要高饱和 / 不要霓虹」跟爆款科技风正面冲突，绝不能提炼成全局共用指令）。
- **语义推荐**：`recommendCoverStyles(title, content)` 用风格表里的 `keywords` 对标题（权重 3）和正文前 600 字（权重 1）做纯字符串命中打分，给出 Top3。刻意不问模型——推荐要在切风格时即时出现，不值得为它花一次 token。稿件页显示成一行虚线小按钮，点一下就切；`finalizeWechatDraft` 也用它挑默认风格。
- **参数**：比例 2.35:1（默认）/ 16:9 / 4:3 / 3:4 / 1:1，**切风格自动带入该风格的 `defaultRatio`**；稿件页 `CoverGenerator` 三条链路可切（迁移进来的 cc2image 风格没有旧提示词链路，按钮不显示），打开时自动回显历史封面
- **代码**：`lib/cover-styles.ts`（风格注册表）· `lib/cover.ts` · `lib/cover-client.ts` · `app/api/cover/{prompt,image,templates}` · `components/CoverGenerator.tsx`；提示词 `prompts/system/cover/styles/*.md`（风格定义）+ `cover-anchor-layout.md`（版式骨架）+ `cover-spec-system.md`（字段拆解）

## WeMark 排版预览主题（2026-07-14 起 11 + 9 套）
- 排版主题 11 套：4 套自研（`lib/wemark/themes.ts`）+ 7 套 wenyan 移植（`lib/wemark/themes-wenyan.ts`，生成物）
- 代码高亮 9 套：3 套内置 + `lib/wemark/code-themes-extra.ts` 的 6 套（转自 highlight.js 官方 CSS）
- 生成物来自一次性转换脚本 `npm run convert:themes`（`scripts/convert-wenyan-themes.ts`）。**日后加主题优先改脚本配置重跑，不要直接手改生成文件**；出处与 Apache-2.0 声明在生成文件头注释
- 设计前提不变：公众号只认内联 style，所有主题必须全内联；伪元素 / nth-child 效果转换时必然丢，别试图用 `<style>` 标签救

## 可写模式（2026-07-30 起，右侧预览也能改稿）
右上角「可写模式」按钮把公众号排版预览切成可编辑视图（`components/WechatWriteView.tsx`，开关记在 `localStorage: ms:wemark-write`）：

- **块级映射**：`renderMarkdownBlocks()`（`lib/wemark/renderer.ts`）用 `marked.lexer` 把正文切成顶层 token，每个 token 单独 `marked.parser` 一次，套 `<div data-md-block="i">` 外壳后走**同一条 transform 流水线**（样式与 `renderMarkdown` 逐字一致），最后按外壳拆回数组。实测所有 token 的 `raw` 拼起来等于原文，所以「渲染块 ↔ Markdown 源」严格一一对应
- **定位**：块源码在整篇 `content` 里用顺序 `indexOf` 定位出字符区间（`stripReferences` 只删整行、折空行、trim，不改行内文字，所以必然命中）。万一没命中，该块降级为**只读**——绝不写到错的位置
- **写回**：点一块 → 原位展开只装这一块源码的编辑框 → 400ms 防抖写回整篇 `content`（`DraftEditor` 那份 state），左侧编辑区/脏标记/保存/AI 链路全部沿用原逻辑。草稿区间由自己维护（写回后 `start + md.length`），**不跟着重新分块的结果走**：用户在块里敲空行把它拆成两块时，跟着 ranges 会把整段草稿塞进前半块 → 正文重复
- **块工具条**：悬停出上移 / 下移 / 下方插入 / 删除，直接按字符区间改字符串
- **内嵌图片**：AI 生成配图是 data URI，编辑时折成 `«内嵌图片N»` 占位，写回前还原（删掉占位符 = 删掉那张图）
- **不做 reflow**：可写模式按正文原始段落渲染。`reflowProse` 是按文本哈希随机拆句的，改一个字整段边界就跳动，编辑时晃眼。想让「所见」= 「复制所得」，点头部「固化重排」把重排写进正文
- **外部改稿保护**：`content` 被左侧编辑区 / AI 修改 / 撤销改掉时（自写标记不匹配）立刻关闭编辑态，避免旧区间串位
- 复制到公众号/小红书/推特仍走 `renderMarkdown` 的整段输出，剪贴板里没有块外壳 div

## 编辑预览滚动同步
`hooks/use-scroll-sync.ts` 双向比例同步：公众号稿的编辑 Textarea（70vh）↔ WechatStudio 预览容器；程序性滚动打 suppress 标记防回环。

## AI 标题
标题框旁按钮，固定走 `deepseek-v4-flash`（`lib/llm.ts` 的 `getFlashModel`，无 DeepSeek key 时退回当前引擎），提示词 `title_system`。
