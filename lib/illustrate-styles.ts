// ===== 正文配图风格注册表（服务端 / 客户端共用的单一事实源）=====
// 这个文件必须保持纯数据 + 纯函数，不许 import 服务端模块——设置页的预设卡片、
// 稿件页的 AI 配图下拉框都直接 import 它。历史上「lib/illustrate-ai.ts 和
// DraftEditor 各抄一份风格常量」的坑就是这么消掉的（与 lib/cover-styles.ts 同款做法）。

export interface AiIllustrateStyle {
  key: string;
  label: string;
  /** 前端下拉框/说明行用的一句话气质描述 */
  hint: string;
  /** 风格提示词 id（prompt-store 注册），生图时取用 */
  promptId: string;
}

// 两套正文配图风格：手绘知识风（正文配图之王，通用知识类文章优先）、
// 怪诞小人风（AI 工作流/系统流程/方法论拆解更贴切）
export const AI_ILLUSTRATE_STYLES: AiIllustrateStyle[] = [
  {
    key: "handdrawn_knowledge_card",
    label: "手绘知识风",
    hint: "手绘知识卡片，通用知识类文章的默认选择",
    promptId: "illustrate_ai_style_handdrawn",
  },
  {
    key: "quirky_doodle_character_flow",
    label: "怪诞小人风",
    hint: "怪诞小人 + 流程箭头，适合工作流 / 方法论拆解",
    promptId: "illustrate_ai_style_quirky_doodle",
  },
];

export const DEFAULT_AI_ILLUSTRATE_STYLE = AI_ILLUSTRATE_STYLES[0];

export function resolveAiIllustrateStyle(key?: string): AiIllustrateStyle {
  return AI_ILLUSTRATE_STYLES.find((s) => s.key === key) ?? DEFAULT_AI_ILLUSTRATE_STYLE;
}

// ===== 正文配图模式（设置页预设的核心开关）=====
// search = 图库搜图（Pexels/Pixabay，免费、快，纯装饰）
// ai     = AI 现生现画知识图解（gpt-image-2，真金白银、慢，信息价值高）
// off    = 生成正文时不配图，留到稿件页手动决定
export const ILLUSTRATE_MODES = [
  { id: "search", label: "图库搜图", hint: "Pexels / Pixabay 搜真实照片插入正文，免费、10-30 秒完成" },
  { id: "ai", label: "AI 生成图解", hint: "拆认知锚点后现生现画，信息价值高；一张图真金白银，且要 1-3 分钟" },
  { id: "off", label: "不配图", hint: "生成正文时不插图，到稿件页再手动挑搜图或 AI 生图" },
] as const;

export type IllustrateMode = (typeof ILLUSTRATE_MODES)[number]["id"];

export function isIllustrateMode(v: unknown): v is IllustrateMode {
  return typeof v === "string" && ILLUSTRATE_MODES.some((m) => m.id === v);
}

export function normalizeIllustrateMode(v: unknown): IllustrateMode {
  return isIllustrateMode(v) ? v : "search";
}

// 单次自动配图张数的硬上限（与 MAX_AI_ILLUSTRATIONS 对齐，成本兜底）
export const MAX_AI_ILLUSTRATIONS = 4;
