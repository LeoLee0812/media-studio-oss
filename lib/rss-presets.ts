// ===== 预置 RSS 订阅源库 =====
// 按「方面」分组的开箱即用订阅源，设置页可整组或逐条一键添加进自己的订阅列表。
// 全部源都用本项目自报的 UA（media-studio-sync/1.0）实测过返回 200（2026-07 验证）。
//
// 维护约定：
// - 只收公网 https 源（要过 lib/config.ts 的 isSafePublicUrl 校验）
// - 新增前先用 curl -A "media-studio-sync/1.0" 实测；伪装浏览器 UA 才能通的源不收
// - category 就是素材的「板块」取值：整组添加时写进 RssFeedConfig.pillar

export interface RssPresetFeed {
  /** 展示名，添加后作为 RssFeedConfig.label */
  label: string;
  url: string;
}

export interface RssPresetGroup {
  /** 分组名 = 添加后素材的板块（pillar）取值 */
  category: string;
  /** 一句话说明这组源适合谁 */
  description: string;
  feeds: RssPresetFeed[];
}

export const RSS_PRESETS: RssPresetGroup[] = [
  {
    category: "AI 官方动态",
    description: "模型厂商第一手发布，适合追新品、新模型的选题",
    feeds: [
      { label: "OpenAI News", url: "https://openai.com/news/rss.xml" },
      { label: "Google DeepMind", url: "https://deepmind.google/blog/rss.xml" },
      { label: "Google AI Blog", url: "https://blog.google/technology/ai/rss/" },
    ],
  },
  {
    category: "AI 科技媒体",
    description: "AI 垂直报道与行业解读，选题密度最高的一组",
    feeds: [
      { label: "TechCrunch AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
      { label: "The Verge AI", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml" },
      { label: "VentureBeat AI", url: "https://venturebeat.com/category/ai/feed/" },
      { label: "MIT News · AI", url: "https://news.mit.edu/rss/topic/artificial-intelligence2" },
    ],
  },
  {
    category: "开发者视角",
    description: "独立观察者与社区热帖，适合有技术含量的深度选题",
    feeds: [
      { label: "Simon Willison", url: "https://simonwillison.net/atom/everything/" },
      { label: "Hacker News 精选", url: "https://hnrss.org/best" },
    ],
  },
  {
    category: "AI 工具发布",
    description: "主流 AI 编程工具的版本发布监控，适合「工具更新解读」类选题",
    feeds: [
      { label: "Claude Code Releases", url: "https://github.com/anthropics/claude-code/releases.atom" },
      { label: "OpenAI Codex Releases", url: "https://github.com/openai/codex/releases.atom" },
      { label: "Gemini CLI Releases", url: "https://github.com/google-gemini/gemini-cli/releases.atom" },
      { label: "Ollama Releases", url: "https://github.com/ollama/ollama/releases.atom" },
      { label: "Cursor Changelog", url: "https://cursor.com/changelog.rss" },
    ],
  },
  {
    category: "科学与认知",
    description: "神经科学与认知科学，适合科普向账号",
    feeds: [
      { label: "Neuroscience News", url: "https://neurosciencenews.com/feed/" },
      { label: "ScienceDaily · Mind & Brain", url: "https://www.sciencedaily.com/rss/mind_brain.xml" },
    ],
  },
  {
    category: "财经与加密",
    description: "加密市场与金融科技，适合交易投资向账号",
    feeds: [
      { label: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
      { label: "Cointelegraph", url: "https://cointelegraph.com/rss" },
    ],
  },
];
