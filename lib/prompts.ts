import type { Platform } from "./types";
import { DEFAULT_STYLE, getStyleDef, type WritingStyle } from "./styles";
import { getPrompt } from "./prompt-store";

// prompts/ 目录仍是写作规则的默认事实源，
// 但网站侧统一经 prompt-store 读取：提示词页保存的覆盖值优先于文件默认值。

const PLATFORM_PROMPT_ID: Record<Platform, string> = {
  wechat: "platform_wechat",
};

export async function getAntiAiRules() {
  return getPrompt("anti_ai_rules");
}
export async function getExpandPipeline() {
  return getPrompt("expand_pipeline");
}
// 平台规范：风格可以整体替换某个平台的规范（如长文风格下公众号的字数/小标题要求完全不同）
export async function getPlatformSpec(
  platform: Platform,
  style: WritingStyle = DEFAULT_STYLE,
) {
  const override = getStyleDef(style).platformOverrides?.[platform];
  return getPrompt(override ?? PLATFORM_PROMPT_ID[platform]);
}

// 风格总纲：默认风格没有总纲，返回空串（生成链路里会被 filter 掉）
export async function getStyleSpec(style: WritingStyle) {
  const id = getStyleDef(style).promptId;
  return id ? getPrompt(id) : "";
}
