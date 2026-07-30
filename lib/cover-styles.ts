// ===== 封面风格注册表（服务端 / 客户端共用的单一事实源）=====
// 这个文件必须保持纯数据 + 纯函数，不许 import fs / 服务端模块——
// 客户端组件（CoverGenerator）直接 import 它，历史上「lib/cover.ts 和组件里各抄一份
// 风格常量、改一处漏一处」的坑就是这么消掉的。
//
// 一套风格 = 一份「风格定义」提示词（styleId）+ 元数据。风格定义描述气质、材质、配色、
// 构图特色和负面清单，两条生图链路都会用到它：
//   · 模板直生（有参考图）：通用模板指令 + 风格定义 + 裁剪安全区 → /images/edits
//   · 锚点直生（无参考图）：通用版式骨架（填入结构化字段）+ 风格定义 + 裁剪安全区 → /images/generations
// 也就是说，模板图从「风格的唯一载体」降级成「可选增强」：先用文字把风格立起来，
// 以后攒够截图再丢进 templates/<key>/ 目录，同一套风格自动从锚点直生升级成模板直生。

export interface CoverStyle {
  /** 风格 key，同时是模板图目录名 prompts/system/cover/templates/<key>/ */
  key: string;
  label: string;
  /** 前端按钮 title 和风格说明行 */
  hint: string;
  /** 风格定义提示词 id（prompt-store 注册），两条链路共用 */
  styleId: string;
  /** 旧提示词链路的系统指令 id；没有的风格不提供提示词链路 */
  legacyPromptId?: string;
  /** 该风格最合适的比例，切风格时前端自动带入 */
  defaultRatio: string;
  /** 适合的选题类型，展示给用户看 */
  bestFor: string[];
  /** 语义推荐用的关键词（纯字符串命中打分，不花 token） */
  keywords: string[];
  /** 风格出处：studio = 本项目原有；cc2image = 迁移自 izscc/cc2image 风格库 */
  origin: "studio" | "cc2image";
}

export const COVER_STYLES: CoverStyle[] = [
  {
    key: "viral_tech",
    label: "爆款科技风",
    hint: "深色高对比 + 霓虹光效 + 3D 大字",
    styleId: "cover_style_def_viral_tech",
    legacyPromptId: "cover_prompt_system",
    defaultRatio: "2.35:1",
    bestFor: ["科技评测", "产品发布", "AI 模型", "行业爆点"],
    keywords: [
      "发布", "上线", "开源", "模型", "GPT", "Claude", "Gemini", "算力", "芯片",
      "显卡", "性能", "跑分", "评测", "实测", "版本", "更新", "功能", "工具",
      "编程", "代码", "Agent", "智能体", "API",
    ],
    origin: "studio",
  },
  {
    key: "mono_system",
    label: "黑白系统风",
    hint: "黑白高对比 + 巨型粗体字 + 编号条码流程导航，方法论手册感",
    styleId: "cover_style_def_mono_system",
    defaultRatio: "2.35:1",
    bestFor: ["方法论", "SOP", "工作流", "提示词库", "系统搭建"],
    keywords: [
      "方法论", "SOP", "流程", "工作流", "系统", "标准", "规范", "框架", "手册",
      "指南", "playbook", "skill", "技能", "提示词", "prompt", "自动化", "流水线",
      "复用", "沉淀", "封装", "路径", "判断", "决策",
    ],
    origin: "cc2image",
  },
  {
    key: "material_type",
    label: "语义字体风",
    hint: "标题字按含义做成真实材质（木/石/蜂蜜/金属/玻璃），干净棚拍背景",
    styleId: "cover_style_def_material_type",
    defaultRatio: "2.35:1",
    bestFor: ["关键词封面", "概念解读", "观点短句", "栏目主视觉"],
    keywords: [
      "什么是", "本质", "真相", "概念", "定义", "关键词", "隐喻", "重新理解",
      "认知", "思考", "观点", "为什么", "反思", "解构",
    ],
    origin: "cc2image",
  },
  {
    key: "crowd_type",
    label: "人群造字风",
    hint: "高空俯视 + 上百微缩真人排成巨大文字/图形，财经社会议题封面",
    styleId: "cover_style_def_crowd_type",
    defaultRatio: "2.35:1",
    bestFor: ["社会议题", "就业趋势", "平台经济", "用户规模", "群体行为"],
    keywords: [
      "就业", "失业", "裁员", "招聘", "岗位", "打工", "年轻人", "职场", "人口",
      "用户", "规模", "亿", "万人", "群体", "社会", "城市", "趋势", "报告",
      "调查", "平台", "外卖", "网约车", "内卷",
    ],
    origin: "cc2image",
  },
  {
    key: "glass_blob",
    label: "玻璃气泡风",
    hint: "半透明液态玻璃体 + 低饱和渐变光晕，文字与形体前后穿插",
    styleId: "cover_style_def_glass_blob",
    defaultRatio: "2.35:1",
    bestFor: ["AI 趋势", "未来预测", "抽象概念", "品牌视觉"],
    keywords: [
      "未来", "趋势", "预测", "变革", "浪潮", "revolution", "AGI", "通用",
      "想象", "边界", "可能性", "重塑", "颠覆", "新范式", "元年",
    ],
    origin: "cc2image",
  },
  {
    key: "timeline_mini",
    label: "时间微缩风",
    hint: "45° 等距俯视微缩沙盘，横向 4-6 段展台演示演化过程",
    styleId: "cover_style_def_timeline_mini",
    defaultRatio: "2.35:1",
    bestFor: ["技术演化", "发展史", "工具变迁", "版本迭代"],
    keywords: [
      "演化", "进化", "变迁", "发展史", "历史", "十年", "三年", "迭代", "版本",
      "从", "到", "过去", "现在", "未来", "回顾", "编年", "时间线", "一路",
      "变化", "代际",
    ],
    origin: "cc2image",
  },
  {
    key: "icon_pedestal",
    label: "图标展台风",
    hint: "浅灰摄影棚 + 3D 图标展台 + 单一强调色粗体大字，产品发布会海报感",
    styleId: "cover_style_def_icon_pedestal",
    defaultRatio: "4:3",
    bestFor: ["公司动态", "融资并购", "商业大事件", "财报数据", "行业对垒"],
    keywords: [
      "亿", "万亿", "融资", "并购", "收购", "买下", "赚", "亏", "季度", "财报",
      "股价", "市值", "官司", "起诉", "被告", "赢了", "输了", "发布会", "CEO",
      "创始人", "上市", "IPO", "营收", "利润", "赛道",
    ],
    origin: "studio",
  },
];

export const COVER_RATIOS = ["2.35:1", "16:9", "4:3", "3:4", "1:1"] as const;

/** 默认风格（老稿件 meta 里存着已下线风格值时的回落目标） */
export const DEFAULT_COVER_STYLE = COVER_STYLES[0];

/** 按 key 取风格；无效值（含已下线的 cinematic / huashu）一律回落到默认风格 */
export function resolveCoverStyle(key?: string): CoverStyle {
  return COVER_STYLES.find((s) => s.key === key) ?? DEFAULT_COVER_STYLE;
}

// ===== 语义推荐 =====
// 拿稿件标题 + 正文开头做关键词命中打分，给出 Top3 推荐风格。
// 刻意用纯字符串匹配而不是问模型：推荐要在用户切风格时即时出现，不值得为它花一次 token。
// 标题里的命中权重更高（标题基本就是选题本身），正文只取开头一段避免长文摊薄。
export function recommendCoverStyles(title: string, content: string, top = 3): CoverStyle[] {
  const head = (title || "").toLowerCase();
  const body = (content || "").slice(0, 600).toLowerCase();
  const scored = COVER_STYLES.map((style) => {
    let score = 0;
    for (const kw of style.keywords) {
      const k = kw.toLowerCase();
      if (head.includes(k)) score += 3;
      if (body.includes(k)) score += 1;
    }
    return { style, score };
  });
  // 命中数相同时保持注册表顺序（默认风格优先），避免推荐结果每次抖动
  scored.sort((a, b) => b.score - a.score);
  return scored.filter((s) => s.score > 0).slice(0, top).map((s) => s.style);
}
