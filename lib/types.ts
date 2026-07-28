// ===== 领域类型 =====

// 板块 = 用户自由命名的素材分类（如「AI 资讯」「科学认知」），不再是固定枚举；
// 空值（null）表示未分类。数据库里是裸 text 列，天然兼容任意字符串。
export type Pillar = string;
export type MaterialSource = "rss" | "manual";
// 超保留期的未处理时效性素材由定时清理直接物理删除，没有「已过期」中转态（2026-07-18 起）
export type MaterialStatus = "new" | "shortlisted" | "used" | "ignored";
export type TopicStatus = "idea" | "selected" | "drafting" | "done" | "dropped";
// 输出平台只有公众号；小红书/抖音是挂在公众号稿件上的导出渲染器，不是独立平台
export type Platform = "wechat";
export type DraftStatus = "draft" | "reviewed" | "published";
export type Generator = "claude_code" | "api";

export interface Material {
  id: string;
  source: MaterialSource;
  source_id: string | null;
  dedupe_key: string | null;
  pillar: Pillar | null;
  title: string | null;
  title_en: string | null;
  url: string | null;
  summary: string | null;
  content: string | null;
  category: string | null;
  tags: string[];
  published_at: string | null;
  status: MaterialStatus;
  raw: unknown;
  created_at: string;
  updated_at: string;
}

export interface Topic {
  id: string;
  title: string | null;
  angle: string | null;
  pillar: Pillar | null;
  persona: string | null;
  material_ids: string[];
  research: unknown;
  status: TopicStatus;
  priority: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Draft {
  id: string;
  topic_id: string | null;
  platform: Platform;
  title: string | null;
  content: string | null;
  meta: DraftMeta | null;
  version: number;
  generator: Generator | null;
  status: DraftStatus;
  published_url: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

// 各平台特有的结构化元数据
export interface DraftMeta {
  // 本篇是用哪种写作风格生成的（见 lib/styles.ts）；缺省视为默认风格。
  // 稿件页的 AI 修改/AI 标题据此沿用同一风格，避免改一次就漂回默认调性。
  style?: string;
  // wechat：AI 封面图的提示词/风格/比例（图本体不落库，前端即时生成下载）
  // mode="template" 表示模板直生（带参考图调 /images/edits，不走文案引擎），此时 prompt 为空
  cover?: { prompt?: string; style?: string; ratio?: string; generatedAt?: string; mode?: string };
  // wechat：AI 配图清单（图片 URL 来自 Pexels/Pixabay，文件由前端经 /api/images/proxy 下载到本地）
  illustrations?: {
    filename: string;
    url: string;
    caption: string;
    keyword?: string;
    credit?: string;
    provider?: string;
  }[];
  // 发布后手动回填的互动数据（轻量回流，不建新表）
  stats?: { views?: number; likes?: number; comments?: number; reposts?: number; recordedAt?: string };
  // 通用：字符数等辅助信息
  [key: string]: unknown;
}

export const PLATFORM_LABELS: Record<Platform, string> = {
  wechat: "公众号",
};

export const SOURCE_LABELS: Record<MaterialSource, string> = {
  rss: "RSS 订阅",
  manual: "手动录入",
};

export const TOPIC_STATUS_LABELS: Record<TopicStatus, string> = {
  idea: "想法",
  selected: "已选",
  drafting: "写作中",
  done: "完成",
  dropped: "放弃",
};

export const MATERIAL_STATUS_LABELS: Record<MaterialStatus, string> = {
  new: "新素材",
  shortlisted: "已入选",
  used: "已用",
  ignored: "忽略",
};

export const DRAFT_STATUS_LABELS: Record<DraftStatus, string> = {
  draft: "草稿",
  reviewed: "已审",
  published: "已发布",
};
