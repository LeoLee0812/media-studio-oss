import { promises as fs } from "fs";
import path from "path";
import { getSyncState, setSyncState } from "./queries";

// ===== 提示词中心 =====
// 把散落在代码里的 AI 系统提示词收拢成一个可视化编辑的注册表：
// - 默认值：全部来自 prompts/ 目录的 md 文件（写作规则唯一事实源），PromptDef 仍保留 kind: "inline"
//   分支以备将来需要临时内置文本，但目前注册表里的条目全部是 kind: "file"
// - 覆盖值：存 ms_sync_state 的 prompt_overrides 键（Record<id, string>），提示词页保存后立即生效
// - 读取优先级：数据库覆盖 > 默认值。清空覆盖即恢复默认。

const OVERRIDES_KEY = "prompt_overrides";
const PROMPTS_DIR = path.join(process.cwd(), "prompts");

export interface PromptDef {
  id: string;
  /** 展示名 */
  label: string;
  /** 分组标题（提示词页按组渲染） */
  group: string;
  /** 一句话说明这段提示词什么时候被用到 */
  description: string;
  /** file = 默认值来自 prompts/ 目录文件；inline = 默认值是下方内置常量 */
  kind: "file" | "inline";
  /** kind=file 时的相对路径 */
  file?: string;
  /** kind=inline 时的默认文本 */
  defaultText?: string;
}

// ---- 注册表 ----
// 说明：以前这里有 13 个 inline 内置默认文本常量（虚构红线、客观性要求、3 套封面风格、
// 选题/调研/配图/标题/改稿/小红书高亮与 emoji 指令），现已全部原样搬进
// prompts/system/ 目录下的 md 文件，PROMPT_DEFS 里对应条目改成 kind: "file"。

export const PROMPT_DEFS: PromptDef[] = [
  {
    id: "objectivity_rules",
    label: "客观性要求",
    group: "正文生成",
    description: "控制稿件少用「我试了试/我体验了一下」等主观色彩表述，注入每次成稿。",
    kind: "file",
    file: "system/objectivity-rules.md",
  },
  {
    id: "fabrication_red_line",
    label: "虚构红线",
    group: "正文生成",
    description: "禁止编造第一人称实测/数据/版本号的最高优先级红线，注入到每次成稿类调用。",
    kind: "file",
    file: "system/fabrication-red-line.md",
  },
  {
    id: "anti_ai_rules",
    label: "反 AI 写作铁律",
    group: "正文生成",
    description: "去 AI 味的文风自查清单，注入到母稿、派生和 AI 修改。默认值来自 prompts/anti-ai-rules.md。",
    kind: "file",
    file: "anti-ai-rules.md",
  },
  {
    id: "expand_pipeline",
    label: "四阶段写作流程",
    group: "正文生成",
    description: "素材→选题→调研→母稿→平台变体的流程说明，注入到母稿生成。默认值来自 prompts/pipeline/expand.md。",
    kind: "file",
    file: "pipeline/expand.md",
  },
  // ——AI 封面图·两份链路级指令——
  {
    id: "cover_template_instruction",
    label: "链路指令 · 模板直生（带参考图）",
    group: "AI 封面图",
    description:
      "「模板直生」链路发给图像模型的固定指令：随该风格的模板参考图 + 风格定义一起提交，让模型照模板风格自己构思新封面。硬约束：底部 10% 干净留白带（无字无图画，深浅不限）。模板图放 prompts/system/cover/templates/<风格>/ 目录。",
    kind: "file",
    file: "system/cover/cover-template-instruction.md",
  },
  {
    id: "cover_spec_system",
    label: "链路指令 · 封面字段拆解",
    group: "AI 封面图",
    description:
      "「锚点直生」链路第一步：文案引擎读稿件 + 风格定义，拆出主标题 / 导语 / 小标签 / 视觉隐喻 / 画面元素五个字段，再填进版式骨架。改这里就能调标题的抓人程度和画面取向。",
    kind: "file",
    file: "system/cover/cover-spec-system.md",
  },
  {
    id: "cover_anchor_layout",
    label: "链路指令 · 锚点直生版式骨架",
    group: "AI 封面图",
    description:
      "「锚点直生」链路（该风格没有模板参考图时走这条）的通用版式骨架：无刊头（不许出现任何刊名/博主名/logo/水印）、标题唯一且为主视觉、导语与小标签、宽幅左右分栏、底部 10% 干净留白带。{{headline}} 等占位符由文案引擎产出的结构化字段填充，后面再拼该风格的风格定义。",
    kind: "file",
    file: "system/cover/cover-anchor-layout.md",
  },
  // ——AI 封面图·每套风格一份「风格定义」，两条链路共用——
  {
    id: "cover_style_def_viral_tech",
    label: "风格定义 · 爆款科技风",
    group: "AI 封面图",
    description:
      "深色高对比背景 + 霓虹辉光 + 超厚描边中文大字 + 1-2 个 glossy 3D 元素。默认风格。",
    kind: "file",
    file: "system/cover/styles/viral-tech.md",
  },
  {
    id: "cover_style_def_mono_system",
    label: "风格定义 · 黑白系统风",
    group: "AI 封面图",
    description:
      "迁移自 cc2image。黑白高对比 + 巨型粗体字 + 细线网格/条形码/REF 编号/01-04 流程导航，方法论手册与 SOP 封面感。适合工作流、提示词库、系统搭建类选题。",
    kind: "file",
    file: "system/cover/styles/mono-system.md",
  },
  {
    id: "cover_style_def_material_type",
    label: "风格定义 · 语义字体风",
    group: "AI 封面图",
    description:
      "迁移自 cc2image。标题字按语义做成真实材质（木/石/蜂蜜/金属/玻璃/火），干净棚拍背景大留白。适合关键词、概念解读类选题。",
    kind: "file",
    file: "system/cover/styles/material-type.md",
  },
  {
    id: "cover_style_def_crowd_type",
    label: "风格定义 · 人群造字风",
    group: "AI 封面图",
    description:
      "迁移自 cc2image。高空俯视 + 上百微缩真人排成巨大文字/数字/图形，财经杂志与社会议题封面质感。适合就业、人口、平台经济类选题。",
    kind: "file",
    file: "system/cover/styles/crowd-type.md",
  },
  {
    id: "cover_style_def_glass_blob",
    label: "风格定义 · 玻璃气泡风",
    group: "AI 封面图",
    description:
      "迁移自 cc2image。半透明液态玻璃体 + 低饱和渐变光晕，文字与形体前后穿插。适合 AI 趋势、未来预测、抽象概念类选题。",
    kind: "file",
    file: "system/cover/styles/glass-blob.md",
  },
  {
    id: "cover_style_def_timeline_mini",
    label: "风格定义 · 时间微缩风",
    group: "AI 封面图",
    description:
      "迁移自 cc2image。45° 等距俯视微缩沙盘，横向 4-6 段展台展示演化过程。适合技术演化、发展史、版本迭代类选题。",
    kind: "file",
    file: "system/cover/styles/timeline-mini.md",
  },
  // ——AI 封面图·旧提示词链路的系统指令（只剩两套原生风格保留）——
  {
    id: "cover_prompt_system",
    label: "提示词链路 · 爆款科技风",
    group: "AI 封面图",
    description:
      "旧「提示词链路」用：文案引擎按稿件写出一整段绘图提示词（深色高对比 + 霓虹 + 3D 大字）。底部 15% 留深色无字标题带。新链路请用上面的「风格定义」。",
    kind: "file",
    file: "system/cover/cover-viral-tech.md",
  },
  {
    id: "angle_system",
    label: "AI 建议角度指令",
    group: "其他 AI 功能",
    description: "素材流「立为选题 → AI 建议角度」按钮背后的系统指令。",
    kind: "file",
    file: "system/angle-system.md",
  },
  {
    id: "research_system",
    label: "调研提炼指令",
    group: "其他 AI 功能",
    description: "自动回溯素材原文后，把裸网页文本提炼成调研笔记时的系统指令。",
    kind: "file",
    file: "system/research-system.md",
  },
  {
    id: "illustrate_system",
    label: "AI 配图选点指令",
    group: "其他 AI 功能",
    description: "公众号稿件页「AI 配图」挑插图位置、生成图库搜索词与中文图注时的系统指令。",
    kind: "file",
    file: "system/illustrate-system.md",
  },
  // ——AI 生成配图（知识图解链路，不搜图，现生现画）——
  {
    id: "illustrate_ai_anchor_system",
    label: "AI 生成配图 · 认知锚点拆图指令",
    group: "其他 AI 功能",
    description:
      "稿件页「AI 生成配图」（知识图解链路，不搜图）拆认知锚点时的系统指令：优先抓核心判断/认知断点/输入输出/分流/对比/承接/常见坑，而非均匀分布视觉呼吸感位置。",
    kind: "file",
    file: "system/illustrate/anchor-system.md",
  },
  {
    id: "illustrate_ai_style_handdrawn",
    label: "AI 生成配图 · 手绘知识风锚点",
    group: "其他 AI 功能",
    description: "「AI 生成配图」手绘知识风的风格锚点文本（材质/配色/负面清单），拼进最终绘图提示词末尾。",
    kind: "file",
    file: "system/illustrate/style-handdrawn-knowledge-card.md",
  },
  {
    id: "illustrate_ai_style_quirky_doodle",
    label: "AI 生成配图 · 怪诞小人风锚点",
    group: "其他 AI 功能",
    description:
      "「AI 生成配图」怪诞小人风的风格锚点文本（小黑角色 DNA + 三色标注规则），适合 AI 工作流/系统流程/方法论拆解类文章，拼进最终绘图提示词末尾。",
    kind: "file",
    file: "system/illustrate/style-quirky-doodle-character-flow.md",
  },
  {
    id: "depattern_system",
    label: "认知反转句改写指令",
    group: "其他 AI 功能",
    description:
      "成稿净化的第二道防线：正文里「不是A而是B」这族句式超过一句时，把多出来的句子交给轻量模型逐句改写成直接陈述（只改命中句，不动全文）。",
    kind: "file",
    file: "system/depattern-system.md",
  },
  {
    id: "translate_system",
    label: "素材翻译指令",
    group: "其他 AI 功能",
    description: "英文素材（RSS 等）标题+摘要翻译成中文的系统指令，采集入库后批量执行，走设置页单独配置的翻译引擎。",
    kind: "file",
    file: "system/translate-system.md",
  },
  {
    id: "title_system",
    label: "AI 重写标题指令",
    group: "其他 AI 功能",
    description: "稿件页标题旁「AI 标题」按钮的系统指令，固定走 deepseek-v4-flash 轻量模型。",
    kind: "file",
    file: "system/title-system.md",
  },
  {
    id: "refine_system",
    label: "AI 修改稿件指令",
    group: "其他 AI 功能",
    description: "稿件页「AI 修改」按反馈定向改稿时的系统指令。",
    kind: "file",
    file: "system/refine-system.md",
  },
  {
    id: "xhs_highlight_system",
    label: "小红书高亮选点指令",
    group: "其他 AI 功能",
    description: "小红书高亮选点系统指令：逐段挑 1-2 句中心句（高亮是小红书唯一的行内强调手段，也是醒目度的主角），走 flash 轻量模型。",
    kind: "file",
    file: "system/xhs/xhs-highlight-system.md",
  },
  {
    id: "xhs_emoji_system",
    label: "小红书段落 emoji 指令",
    group: "其他 AI 功能",
    description: "小红书段落 emoji 系统指令：只给部分段落点缀内容相关 emoji（配角，可段首可段尾），与高亮并行跑，走 flash 轻量模型。",
    kind: "file",
    file: "system/xhs/xhs-emoji-system.md",
  },
  {
    id: "douyin_summary_system",
    label: "抖音长文摘要指令",
    group: "其他 AI 功能",
    description: "抖音长文「文章摘要」生成指令：一次给 3 个 ≤30 字的钩子候选（制造信息缺口、不复述标题），走 flash 轻量模型。",
    kind: "file",
    file: "system/douyin/douyin-summary-system.md",
  },
  {
    id: "platform_wechat",
    label: "公众号平台规范",
    group: "平台规范",
    description: "公众号稿件的硬约束与结构骨架。默认值来自 prompts/platforms/wechat.md。",
    kind: "file",
    file: "platforms/wechat.md",
  },
];

const DEF_BY_ID = new Map(PROMPT_DEFS.map((d) => [d.id, d]));

// 文件默认值缓存（文件在部署间不变，可安全缓存进程内）——全站只许有这一份 prompts/ 文件缓存。
const fileCache = new Map<string, string>();

async function readPromptFile(rel: string): Promise<string> {
  if (fileCache.has(rel)) return fileCache.get(rel)!;
  try {
    const txt = await fs.readFile(path.join(PROMPTS_DIR, rel), "utf8");
    fileCache.set(rel, txt);
    return txt;
  } catch {
    return "";
  }
}

// 某条提示词的默认值
export async function getPromptDefault(id: string): Promise<string> {
  const def = DEF_BY_ID.get(id);
  if (!def) return "";
  if (def.kind === "file" && def.file) return readPromptFile(def.file);
  return def.defaultText ?? "";
}

// 读取全部覆盖值（DB 出错时退回空覆盖，保证生成链路不因提示词中心故障而挂掉）
export async function getPromptOverrides(): Promise<Record<string, string>> {
  const v = (await getSyncState(OVERRIDES_KEY).catch(() => null)) as Record<string, string> | null;
  return v && typeof v === "object" ? v : {};
}

// 生效的提示词：覆盖值优先，其次默认值
export async function getPrompt(id: string): Promise<string> {
  const overrides = await getPromptOverrides();
  const o = overrides[id];
  if (typeof o === "string" && o.trim()) return o;
  return getPromptDefault(id);
}

// 保存/清除覆盖值：content 为空（或与默认一致）即清除，恢复默认
export async function setPromptOverride(id: string, content: string): Promise<void> {
  if (!DEF_BY_ID.has(id)) throw new Error(`未知提示词 id：${id}`);
  const overrides = await getPromptOverrides();
  const def = await getPromptDefault(id);
  const trimmed = content.trim();
  if (!trimmed || trimmed === def.trim()) delete overrides[id];
  else overrides[id] = content;
  await setSyncState(OVERRIDES_KEY, overrides);
}
