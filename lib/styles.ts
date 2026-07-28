// ===== 写作风格注册表 =====
// 生成稿件时可切换的「文风包」。默认风格＝客观科普调性。
//
// 一个风格能做三件事：
// 1. 注入一段风格总纲提示词（promptId）
// 2. 替换某个平台的平台规范（platformOverrides，如公众号的字数/小标题要求整体不同）
// 3. 停用与之直接冲突的通用提示词（dropObjectivity：客观性要求压主观表述，与「活人感」类风格正面冲突）
//
// 新增风格：加一个 StyleDef + 在 prompt-store 注册对应提示词文件即可，生成链路无需改动。

import type { Platform } from "./types";

export type WritingStyle = "default";

export interface StyleDef {
  id: WritingStyle;
  label: string;
  /** 选择器下方的一句话说明 */
  hint: string;
  /**
   * 风格适用的平台白名单（不填 = 全平台）。
   * 长文类风格的条款（如「句式断裂至少 3 次」）塞给短文平台是自相矛盾的指令——
   * 不适用的平台自动退回默认风格（见 effectiveStyle）。
   */
  appliesTo?: Platform[];
  /** 风格总纲提示词 id（default 无） */
  promptId?: string;
  /** 平台规范的风格专属替换：platform → 提示词 id */
  platformOverrides?: Partial<Record<Platform, string>>;
  /** 是否停用「客观性要求」 */
  dropObjectivity?: boolean;
  /** 公众号正文 schema 的字数/排版描述（覆盖默认 description，让结构化输出的约束与提示词一致） */
  wechatContentHint?: string;
  /** 追加到「AI 重写标题指令」之后的标题调性提示词 id */
  titlePromptId?: string;
  /**
   * 交付前最后一遍扫描，追加在 user prompt 末尾（模型最后读到的位置注意力最强）。
   * 长文里模型对开头 system 的硬禁令会漂，这条是补一次近距离提醒。
   */
  finalCheck?: string;
  /**
   * 成稿后的确定性净化。提示词只能概率性遵守，纯机械的排版禁令（如破折号）
   * 交给代码兜底：实测长文里破折号仍会漏出十来处，一次替换即可根除。
   */
  sanitize?: (text: string) => string;
  /**
   * 用户没给真实经历（「真实经历」栏为空）时额外注入的约束。
   *
   * 为什么需要它：叙事型风格（调查实验型/产品体验型/亲自下场）天然要求第一手经历，
   * 素材里没有经历时，模型为了把风格写像会编一个。光靠禁令压不住，因为禁令和风格
   * 在打架。解法是换骨架：锁定到不依赖亲身下场的「现象解读型」，
   * 活人感改由态度和判断来扛，风格保住了，也不用编故事。
   */
  noExperienceHint?: string;
}

export const STYLE_DEFS: StyleDef[] = [
  {
    id: "default",
    label: "默认风格",
    hint: "客观科普调性，小标题分节，1500-3000 字。",
    // 默认风格也挂 finalCheck：认知反转句这类纯语义 AI 味，system 层的 anti-ai-rules 在长文里
    // 会「漂」（模型对开头硬禁令的注意力随篇幅衰减），破折号能靠代码净化根除，「不是A而是B」不能。
    // 在 prompt 末尾（注意力最强处）近距离再钉一遍，且不光禁、还给改写示范
    //（否定指令有粉红大象效应，只说「别写不是A而是B」反而激活这个模板，配一个正面改法才压得住）。
    // 与 dePatternText（第二道防线，见 styled-generate.ts）保留 1 处的阈值对齐，两道防线一致。
    // 只收纯语义、代码净化替不了的几条——科普文用冒号/破折号是正常的，不做标点禁令。
    finalCheck: [
      "交付前把全文再扫一遍，下面几条是纯语义的 AI 味，代码净化替不掉，命中就地改：",
      "① 认知反转句（不是 A 而是 B、与其说 A 不如说 B、表面上 A 实际上 B、问题不在 X 在 Y、说是 A 其实是 B），全文最多留一处，只留给全篇最核心的那个转折，其余全部改成直接陈述。改法是把 B 直接说出来、A 顺带否掉或干脆不提，别用换皮变体敷衍：",
      "   ❌「这不是一次更新，而是一次范式转移」→ ✅「这次更新真正动的是范式，不只是加了几个功能」。",
      "② 三段式凑数：观点不够三条就写两条，别为了对称硬凑第三点。华丽词空排比（无缝、直观、强大）删掉，换成一个具体功能或数据。",
      "③ 模糊归因当论据：出现「研究表明 / 专家认为 / 行业报告显示」却给不出具体机构 + 年份 + 结论的，删掉该句或补上出处。",
      "④ 填充拐杖词一律删，直接进正题：值得注意的是、不难发现、总的来说、众所周知、在这个……的时代。",
    ].join("\n"),
  },
];

const BY_ID = new Map(STYLE_DEFS.map((s) => [s.id, s]));

export const DEFAULT_STYLE: WritingStyle = "default";

export function isWritingStyle(v: unknown): v is WritingStyle {
  return typeof v === "string" && BY_ID.has(v as WritingStyle);
}

/** 未知/缺省一律退回默认风格，保证生成链路不因脏数据挂掉 */
export function normalizeStyle(v: unknown): WritingStyle {
  return isWritingStyle(v) ? v : DEFAULT_STYLE;
}

export function getStyleDef(style: WritingStyle): StyleDef {
  return BY_ID.get(style) ?? BY_ID.get(DEFAULT_STYLE)!;
}

/**
 * 某平台上实际生效的风格：风格声明了 appliesTo 且不含该平台时退回默认风格。
 * 所有按平台出稿的路径都要先过这一层，再拿风格去取提示词/schema/净化。
 */
export function effectiveStyle(style: WritingStyle, platform: Platform): WritingStyle {
  const applies = getStyleDef(style).appliesTo;
  if (applies && !applies.includes(platform)) return DEFAULT_STYLE;
  return style;
}

export const STYLE_LABELS: Record<WritingStyle, string> = STYLE_DEFS.reduce(
  (acc, s) => {
    acc[s.id] = s.label;
    return acc;
  },
  {} as Record<WritingStyle, string>,
);
