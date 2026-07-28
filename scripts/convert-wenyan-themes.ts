/**
 * wenyan 主题资产 → wemark 内联样式主题 的一次性转换脚本。
 *
 * 用法：npm run convert:themes
 *   （可选环境变量 WENYAN_CSS_DIR 指向本地 CSS 目录，否则从 GitHub raw 拉取并缓存到 .cache/）
 *
 * 做两件事：
 * 1. 排版主题：解析 caol64/wenyan-core（Apache-2.0）的 7 套公众号主题 CSS，
 *    展开 CSS 变量、把强调色映射为可调主色 ${primary}、相对字号换算为 fs 比例，
 *    生成 lib/wemark/themes-wenyan.ts（StyleMap 形式，渲染器架构不变）。
 * 2. 代码高亮：解析 node_modules/highlight.js/styles 下 6 套官方主题 CSS，
 *    生成 lib/wemark/code-themes-extra.ts（CodeThemeDef 形式）。
 *
 * 无法内联的规则（::before/::after、nth-child 斑马纹、嵌套选择器等）会被丢弃，
 * 全部打印到控制台供人工复核——这是公众号「只认 style 属性」的固有约束，
 * wenyan 自己走内联发布时同样会丢，不要试图用 <style> 标签去救。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const CACHE_DIR = path.join(ROOT, ".cache", "wenyan-themes");
const RAW_BASE = "https://raw.githubusercontent.com/caol64/wenyan-core/main/src/assets/themes";

/* ==================== 通用 CSS 解析 ==================== */

interface CssRule {
  selectors: string[];
  decls: Array<[string, string]>;
}

/** 按括号深度拆分声明（值里可能有 url(...;...) 这类含分号的内容） */
function splitDecls(body: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let depth = 0;
  let cur = "";
  const flush = () => {
    const i = cur.indexOf(":");
    if (i > 0) {
      const prop = cur.slice(0, i).trim().toLowerCase();
      const value = cur.slice(i + 1).trim().replace(/\s+/g, " ");
      if (prop && value) out.push([prop, value]);
    }
    cur = "";
  };
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === ";" && depth === 0) { flush(); continue; }
    cur += ch;
  }
  flush();
  return out;
}

function parseCss(css: string): CssRule[] {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CssRule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(noComments))) {
    const selectors = m[1].split(",").map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean);
    const decls = splitDecls(m[2]);
    if (selectors.length && decls.length) rules.push({ selectors, decls });
  }
  return rules;
}

/** 收集 :root 变量并递归展开 var(--x[, fallback]) */
function expandVars(rules: CssRule[]): CssRule[] {
  const vars = new Map<string, string>();
  for (const r of rules) {
    if (!r.selectors.includes(":root")) continue;
    for (const [p, v] of r.decls) if (p.startsWith("--")) vars.set(p, v);
  }
  const expand = (value: string): string => {
    for (let i = 0; i < 8; i++) {
      const next = value.replace(/var\((--[\w-]+)(?:\s*,\s*([^()]*))?\)/g, (_m, name: string, fb?: string) =>
        vars.get(name) ?? fb ?? _m,
      );
      if (next === value) break;
      value = next;
    }
    return value;
  };
  return rules
    .filter((r) => !r.selectors.includes(":root"))
    .map((r) => ({ selectors: r.selectors, decls: r.decls.map(([p, v]) => [p, expand(v)] as [string, string]) }));
}

/* ==================== 排版主题转换 ==================== */

/** wemark StyleMap 必须覆盖的全部 key（照抄 themes.ts 的 classic） */
const REQUIRED_KEYS = [
  "container", "h1", "h2", "h3", "h4", "h5", "h6", "p", "blockquote", "blockquote_p",
  "ul", "ol", "li", "code_inline", "a", "strong", "em", "del", "hr", "img",
  "figure", "figcaption", "table", "th", "td",
  "footnotes_hr", "footnotes_title", "footnote_item", "sup",
];

/**
 * 选择器 → StyleMap key 映射表。
 * 值为 null 表示「明确知道映射不了，静默丢弃」；不在表内的选择器丢弃时会告警。
 * h2 span 特殊：wenyan 渲染器会把标题文字包一层 span，wemark 不包，
 * 所以把 span 的样式并进 h2 本体（后写的覆盖先写的），近似还原徽章效果。
 */
const SELECTOR_MAP: Record<string, string | null> = {
  "#wenyan": "container",
  "#wenyan h1": "h1", "#wenyan h2": "h2", "#wenyan h3": "h3",
  "#wenyan h4": "h4", "#wenyan h5": "h5", "#wenyan h6": "h6",
  // phycat 源文件笔误：漏写 #wenyan 前缀的裸标签选择器，按带前缀处理
  h4: "h4", h5: "h5", h6: "h6",
  "#wenyan h2 span": "h2",
  "#wenyan p": "p",
  "#wenyan p strong": "strong", "#wenyan strong": "strong",
  "#wenyan p em": "em", "#wenyan em": "em",
  "#wenyan del": "del",
  "#wenyan a": "a",
  "#wenyan hr": "hr",
  "#wenyan img": "img",
  "#wenyan blockquote": "blockquote",
  "#wenyan blockquote p": "blockquote_p",
  "#wenyan ul": "ul", "#wenyan ol": "ol",
  "#wenyan > ul": "ul", "#wenyan > ol": "ol",
  "#wenyan li": "li",
  "#wenyan p code": "code_inline", "#wenyan li code": "code_inline", "#wenyan span code": "code_inline",
  "#wenyan table": "table",
  "#wenyan table th": "th", "#wenyan table td": "td",
  "#wenyan .footnote": "sup",
  "#wenyan #footnotes p": "footnote_item",
  // 代码块由 lib/wemark 的高亮引擎全权接管，pre 相关样式不采
  "#wenyan pre": null, "#wenyan pre code": null,
  // 结构对不上或无对应 key 的，明确丢弃
  "#wenyan h1 span": null, "#wenyan h3 span": null,
  "#wenyan h2 a": null, "#wenyan h2 code": null, "#wenyan h2 strong": null, "#wenyan h3 a": null,
  "#wenyan ul ul": null, "#wenyan li > p": null,
  "#wenyan blockquote blockquote": null, "#wenyan blockquote a": null,
  "#wenyan span img": null,
  "#wenyan .footnote-num": null, "#wenyan .footnote-txt": null,
};

/** 逐条声明级别的通用丢弃：对内联/公众号无意义的属性 */
const DROP_PROPS = new Set(["cursor", "transition", "position", "content", "-webkit-text-decoration"]);

interface WenyanThemeConfig {
  id: string;
  file: string;
  label: string;
  desc: string;
  /** 原作者/出处，写进生成文件的注释 */
  credit: string;
  /** 正文颜色（wenyan 靠宿主页面继承，内联化后必须显式给出） */
  textColor: string;
  /** 主题强调色 → 主色模板的映射（按 key 长度降序替换，长的先换） */
  colorMap: Record<string, string>;
  /** 个别 key 要丢掉的属性（如上游把 hr 的 border-top 误伤到 p、图标伪元素丢失后残留的 display:flex） */
  dropDecls?: Record<string, string[]>;
  /** 个别 key 追加的补偿样式（模板片段，追加在末尾故可覆盖前面）——用于伪元素装饰丢失后的近似还原 */
  extraDecls?: Record<string, string>;
}

const THEME_CONFIGS: WenyanThemeConfig[] = [
  {
    id: "lapis", file: "lapis.css", label: "青金",
    desc: "实心徽章二级标题，青金石学术蓝",
    credit: "typora-theme-lapis（作者 YiNN，https://github.com/YiNNx/typora-theme-lapis）",
    textColor: "#40464f",
    colorMap: { "#4870ac": "${primary}" },
  },
  {
    id: "maize", file: "maize.css", label: "玉米",
    desc: "暖黄强调 + 柔和圆角图片，玉米暖调",
    credit: "typora-maize-theme（作者 BEATREE，https://github.com/BEATREE/typora-maize-theme）",
    textColor: "#3f3f3f",
    colorMap: {
      "rgb(255, 216, 181)": "${primary}4d",
      "rgb(235, 76, 55)": "${primary}",
      "#fff9f9": "${primary}0d",
      "#e49123": "${primary}",
      "#ffb11b": "${primary}",
    },
    // h2 的蜂鸟图标是 ::before 伪元素，必然丢失；flex 是为图标对齐服务的，一并去掉
    //（flex 会吃掉标题内多个子节点间的空格），补一条主色左竖线保住 h2/h3 层级可辨
    dropDecls: { h2: ["display", "align-items"] },
    extraDecls: { h2: "border-left:4px solid ${primary};padding-left:10px;" },
  },
  {
    id: "orangeheart", file: "orangeheart.css", label: "橙心",
    desc: "标签式二级标题 + 暖底引用块，橙心风",
    credit: "typora-theme-orange-heart（作者 evgo2017，https://github.com/evgo2017/typora-theme-orange-heart）",
    textColor: "#3f3f3f",
    colorMap: {
      "rgb(239, 112, 96)": "${primary}",
      "#fff9f9": "${primary}0d",
    },
  },
  {
    id: "phycat", file: "phycat.css", label: "薄荷",
    desc: "渐变徽章标题 + 细密行距，物理猫科普风",
    credit: "typora-theme-phycat（作者 sumruler，https://github.com/sumruler/typora-theme-phycat）",
    textColor: "#333333",
    colorMap: {
      "linear-gradient(to right, #3db8d3, #80f7c4)": "linear-gradient(90deg,${primary},${primary}b3)",
      "var(--primary-color)": "${primary}", // 上游 .footnote 引用了未定义变量
      "#7aeaf018": "${primary}14",
      "#7aeaf077": "${primary}66",
      "#7aeaf0": "${primary}99",
      "#3db8bf": "${primary}",
      "#089ba3": "${primary}",
    },
    // h3-h6 的圆点/图标是伪元素，必然丢失；flex 同样是为图标服务的，去掉防止吃空格
    dropDecls: {
      h3: ["display", "align-items"], h4: ["display", "align-items"],
      h5: ["display", "align-items"], h6: ["display", "align-items"],
    },
  },
  {
    id: "pie", file: "pie.css", label: "正红",
    desc: "居中虚线大标题 + 正红强调，Pie 杂志风",
    credit: "typora-theme-pie（作者 kevinzhao2233，https://github.com/kevinzhao2233/typora-theme-pie）",
    textColor: "#262626",
    colorMap: {
      "rgb(239, 112, 96)": "${primary}",
      "#da282a": "${primary}",
      "#e6514e": "${primary}",
      "#f27f79": "${primary}99",
      "#fff2f0": "${primary}14",
    },
    // 原 24px 顶部内边距是给 ::before 的大引号留位的，引号丢失后收紧
    extraDecls: { blockquote: "padding:12px 16px;" },
  },
  {
    id: "purple", file: "purple.css", label: "紫韵",
    desc: "左竖线二级标题 + 淡紫引用，人文随笔风",
    credit: "typora-purple-theme（作者 hliu202，https://github.com/hliu202/typora-purple-theme）",
    textColor: "#444444",
    colorMap: {
      "rgba(116, 95, 181, 0.2)": "${primary}33",
      "#8064a9": "${primary}",
      "#745fb5": "${primary}",
      "#f4f2f9": "${primary}0d",
    },
    // 上游把 p 和 hr 写在同一条规则里，border-top 误伤段落，剥掉
    dropDecls: { p: ["border-top"] },
    // hr 只设了 border-top，压掉浏览器默认的其余三边立体边框
    extraDecls: { hr: "border-left:none;border-right:none;border-bottom:none;" },
  },
  {
    id: "rainbow", file: "rainbow.css", label: "彩虹",
    desc: "粉彩色块标题 + 多彩表格，轻快活泼",
    credit: "typora-theme-rainbow（作者 thezbm，https://github.com/thezbm/typora-theme-rainbow）",
    textColor: "#3f3f3f",
    colorMap: {
      "rgb(255, 191, 191)": "${primary}66",
      "rgb(255, 232, 232)": "${primary}1f",
      "rgb(31, 117, 255)": "${primary}",
    },
  },
];

/** 缺失 key 的兜底样式（模板代码片段，参考 classic 的中性写法） */
const FALLBACKS: Record<string, string> = {
  figure: "margin:1.4em 0;",
  figcaption: "margin-top:0.5em;color:#888888;font-size:${Math.round(fs * 0.85)}px;text-align:center;",
  footnotes_hr: "margin:3em 0 1em;border:none;border-top:1px dashed ${primary}66;",
  footnotes_title: "margin:0 0 0.5em;color:${primary};font-size:${Math.round(fs * 0.95)}px;font-weight:bold;",
  footnote_item: "margin:0.3em 0;color:#888888;font-size:${Math.round(fs * 0.85)}px;word-break:break-all;",
  sup: "color:${primary};font-size:${Math.round(fs * 0.75)}px;margin-left:2px;",
  strong: "font-weight:bold;",
  em: "font-style:italic;",
  del: "color:#888888;text-decoration:line-through;",
  blockquote_p: "margin:0.5em 0;",
  li: "margin:0.4em 0;",
  p: "margin:1em 0;",
  hr: "margin:2em 0;border:none;border-top:1px solid #e5e5e5;",
};

const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Helvetica Neue','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 相对字号 → fs 比例模板。basePx 是该主题 #wenyan 的基准字号 */
function convertFontSize(value: string, basePx: number, isContainer: boolean): string | undefined {
  const em = /^([\d.]+)(em|rem)$/.exec(value);
  const px = /^([\d.]+)px$/.exec(value);
  let ratio: number | undefined;
  if (em) ratio = parseFloat(em[1]);
  else if (px) ratio = parseFloat(px[1]) / basePx;
  if (ratio === undefined) return undefined; // 百分比/关键字等，原样保留
  if (isContainer || Math.abs(ratio - 1) < 0.001) return "${fs}px";
  return "${Math.round(fs * " + String(Math.round(ratio * 100) / 100) + ")}px";
}

function convertWenyanTheme(cfg: WenyanThemeConfig, css: string): { code: string; dropped: string[] } {
  const dropped: string[] = [];
  const rules = expandVars(parseCss(css));

  // 基准字号：#wenyan 规则里的 font-size
  let basePx = 16;
  for (const r of rules) {
    if (!r.selectors.includes("#wenyan")) continue;
    for (const [p, v] of r.decls) {
      const m = /^([\d.]+)px$/.exec(v);
      if (p === "font-size" && m) basePx = parseFloat(m[1]);
    }
  }

  // 逐规则归并到 StyleMap key（同 key 同属性后写的覆盖先写的）
  const keyDecls = new Map<string, Map<string, string>>();
  const put = (key: string, prop: string, value: string) => {
    if (!keyDecls.has(key)) keyDecls.set(key, new Map());
    keyDecls.get(key)!.set(prop, value);
  };

  for (const rule of rules) {
    for (const sel of rule.selectors) {
      if (/::?(before|after|selection|marker)|:nth-child|:hover/.test(sel)) {
        dropped.push(`${sel} { ${rule.decls.map(([p, v]) => `${p}: ${v}`).join("; ")} }`);
        continue;
      }
      const key = SELECTOR_MAP[sel];
      if (key === null) continue;
      if (key === undefined) {
        dropped.push(`${sel} { ${rule.decls.map(([p, v]) => `${p}: ${v}`).join("; ")} }`);
        continue;
      }
      for (const [prop, value] of rule.decls) {
        if (DROP_PROPS.has(prop)) continue;
        if (cfg.dropDecls?.[key]?.includes(prop)) continue;
        if (key === "footnote_item" && prop === "display") continue; // 我们的脚注是纯文本 p，不需要 flex
        if (prop === "font-size") {
          const converted = convertFontSize(value, basePx, key === "container");
          put(key, prop, converted ?? value);
        } else {
          put(key, prop, value);
        }
      }
    }
  }

  // 容器补齐：字体栈 / 正文色 / 折行（wenyan 靠宿主继承，内联化必须显式）
  const container = keyDecls.get("container") ?? new Map<string, string>();
  if (!container.has("font-family")) container.set("font-family", FONT_STACK);
  if (!container.has("color")) container.set("color", cfg.textColor);
  if (!container.has("text-align")) container.set("text-align", "left");
  if (!container.has("word-break")) container.set("word-break", "break-word");
  keyDecls.set("container", container);

  // sup（.footnote 上标）补齐缩小字号
  const sup = keyDecls.get("sup");
  if (sup && !sup.has("font-size")) {
    sup.set("font-size", "${Math.round(fs * 0.75)}px");
    sup.set("margin-left", "2px");
  }

  // 主色模板替换（长 key 先换，避免 8 位 hex 被 6 位截胡）
  const colorEntries = Object.entries(cfg.colorMap).sort((a, b) => b[0].length - a[0].length);
  const applyColors = (v: string): string => {
    for (const [literal, tpl] of colorEntries) {
      v = v.replace(new RegExp(escapeRegExp(literal), "gi"), tpl);
    }
    return v;
  };

  // 组装 StyleMap 代码
  const lines: string[] = [];
  const missing: string[] = [];
  for (const key of REQUIRED_KEYS) {
    const decls = keyDecls.get(key);
    let css: string;
    if (decls && decls.size) {
      css = Array.from(decls.entries()).map(([p, v]) => `${p}:${applyColors(v)};`).join("")
        + (cfg.extraDecls?.[key] ?? "");
    } else if (FALLBACKS[key]) {
      css = FALLBACKS[key];
      missing.push(key);
    } else {
      throw new Error(`[${cfg.id}] 缺少 key「${key}」且无兜底样式`);
    }
    lines.push(`    ${key}: \`${css}\`,`);
  }
  if (missing.length) console.log(`  [${cfg.id}] 兜底补齐：${missing.join(", ")}`);

  const code = `/* ==================== ${cfg.label} ${cfg.id} —— ${cfg.credit} ==================== */
const ${cfg.id}: ThemeDef = {
  id: '${cfg.id}',
  label: '${cfg.label}',
  desc: '${cfg.desc}',
  styles: ({ primary, fontSize: fs }) => ({
${lines.join("\n")}
  }),
}
`;
  return { code, dropped };
}

/* ==================== highlight.js 主题转换 ==================== */

interface HljsThemeConfig {
  id: string;
  label: string;
  file: string; // 相对 node_modules/highlight.js/styles/
}

const HLJS_CONFIGS: HljsThemeConfig[] = [
  { id: "github-dark", label: "GitHub 深色", file: "github-dark.css" },
  { id: "atom-one-light", label: "Atom One 浅色", file: "atom-one-light.css" },
  { id: "dracula", label: "Dracula", file: "base16/dracula.css" },
  { id: "solarized-light", label: "Solarized 浅色", file: "base16/solarized-light.css" },
  { id: "solarized-dark", label: "Solarized 深色", file: "base16/solarized-dark.css" },
  { id: "xcode", label: "Xcode", file: "xcode.css" },
];

/** 高亮主题只保留这些视觉属性 */
const HLJS_KEEP_PROPS = new Set(["color", "background", "background-color", "font-style", "font-weight", "text-decoration"]);

function convertHljsTheme(cfg: HljsThemeConfig, css: string): { code: string; dropped: string[] } {
  const dropped: string[] = [];
  const rules = parseCss(css);
  let background = "#ffffff";
  let color = "#333333";
  const tokens = new Map<string, string>();

  for (const rule of rules) {
    for (const sel of rule.selectors) {
      if (sel === ".hljs" || sel === "pre code.hljs" || sel === "code.hljs") {
        if (sel === ".hljs") {
          for (const [p, v] of rule.decls) {
            if (p === "background" || p === "background-color") background = v;
            if (p === "color") color = v;
          }
        }
        continue;
      }
      if (/::|:hover| /.test(sel) && !/^\.hljs-[\w.-]+$/.test(sel)) {
        dropped.push(`${sel} { ${rule.decls.map(([p, v]) => `${p}: ${v}`).join("; ")} }`);
        continue;
      }
      // .hljs-title.function_ 复合类：取最后一段类名（与 highlightToInline 的查表规则对齐）
      const classes = sel.split(".").filter(Boolean);
      const last = classes[classes.length - 1];
      if (!classes[0].startsWith("hljs-") ) {
        dropped.push(`${sel} { ... }`);
        continue;
      }
      const key = last.replace(/^hljs-/, "").replace(/_+$/, "");
      const decls = rule.decls
        .filter(([p]) => HLJS_KEEP_PROPS.has(p))
        .map(([p, v]) => `${p === "background-color" ? "background" : p}:${v};`)
        .join("");
      if (!decls) continue;
      tokens.set(key, (tokens.get(key) ?? "") + decls);
    }
  }

  const tokenLines = Array.from(tokens.entries()).map(([k, v]) => `    '${k}': '${v}',`);
  const code = `/* ${cfg.label}（highlight.js 官方 ${cfg.file}） */
const ${cfg.id.replace(/-(\w)/g, (_m, c: string) => c.toUpperCase())}: CodeThemeDef = {
  id: '${cfg.id}',
  label: '${cfg.label}',
  background: '${background}',
  color: '${color}',
  tokens: {
${tokenLines.join("\n")}
  },
}
`;
  return { code, dropped };
}

/* ==================== 主流程 ==================== */

async function loadWenyanCss(file: string): Promise<string> {
  const localDir = process.env.WENYAN_CSS_DIR;
  if (localDir) {
    const p = path.join(localDir, file);
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  }
  const cached = path.join(CACHE_DIR, file);
  if (fs.existsSync(cached)) return fs.readFileSync(cached, "utf8");
  const res = await fetch(`${RAW_BASE}/${file}`);
  if (!res.ok) throw new Error(`拉取 ${file} 失败：HTTP ${res.status}`);
  const text = await res.text();
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cached, text);
  return text;
}

async function main() {
  /* ---------- 排版主题 ---------- */
  const themeCodes: string[] = [];
  for (const cfg of THEME_CONFIGS) {
    const css = await loadWenyanCss(cfg.file);
    const { code, dropped } = convertWenyanTheme(cfg, css);
    themeCodes.push(code);
    if (dropped.length) {
      console.log(`  [${cfg.id}] 丢弃 ${dropped.length} 条无法内联的规则：`);
      for (const d of dropped) console.log(`    - ${d}`);
    }
  }

  const themesFile = `/**
 * wenyan 公众号排版主题移植（本文件由 scripts/convert-wenyan-themes.ts 生成，
 * 手工微调后如需重新生成请先 diff；重跑：npm run convert:themes）。
 *
 * 主题 CSS 来源：caol64/wenyan-core（https://github.com/caol64/wenyan-core，Apache-2.0），
 * 其中 lapis 源自 YiNNx/typora-theme-lapis（作者 YiNN），其余各主题原作者见各段注释。
 *
 * 转换约定：
 * - CSS 变量已展开；各主题强调色映射为可调主色 \${primary}，字号按与正文的比例挂到 \${fs}
 * - wenyan 的 ::before/::after 装饰、nth-child 斑马纹无法写进 style 属性，已按公众号约束舍弃
 *   （公众号后台会剥掉 <style>，wenyan 自己内联发布时同样丢，不要用 <style> 去救）
 * - wenyan 渲染器把标题文字包 span，wemark 不包，h2 span 的徽章样式已并入 h2 本体
 * - 代码块样式由 lib/wemark/highlight.ts 全权接管，未从 wenyan 采集 pre 规则
 */
import type { ThemeDef } from './themes'

${themeCodes.join("\n")}
export const WENYAN_THEMES: ThemeDef[] = [${THEME_CONFIGS.map((c) => c.id).join(", ")}]
`;
  const themesOut = path.join(ROOT, "lib/wemark/themes-wenyan.ts");
  fs.writeFileSync(themesOut, themesFile);
  console.log(`✅ 排版主题 ${THEME_CONFIGS.length} 套 → ${path.relative(ROOT, themesOut)}`);

  /* ---------- 代码高亮主题 ---------- */
  const hljsCodes: string[] = [];
  for (const cfg of HLJS_CONFIGS) {
    const css = fs.readFileSync(path.join(ROOT, "node_modules/highlight.js/styles", cfg.file), "utf8");
    const { code, dropped } = convertHljsTheme(cfg, css);
    hljsCodes.push(code);
    if (dropped.length) {
      console.log(`  [${cfg.id}] 丢弃 ${dropped.length} 条选择器：`);
      for (const d of dropped) console.log(`    - ${d}`);
    }
  }

  const hljsFile = `/**
 * 代码高亮主题扩充（本文件由 scripts/convert-wenyan-themes.ts 生成；重跑：npm run convert:themes）。
 * 全部转换自项目内 node_modules/highlight.js/styles 的官方主题 CSS（BSD-3-Clause），
 * 未经过 wenyan——highlight.js 本就是官方主题源，省一层依赖也无 license 问题。
 */
import type { CodeThemeDef } from './highlight'

${hljsCodes.join("\n")}
export const EXTRA_CODE_THEMES: CodeThemeDef[] = [${HLJS_CONFIGS.map((c) => c.id.replace(/-(\w)/g, (_m, ch: string) => ch.toUpperCase())).join(", ")}]
`;
  const hljsOut = path.join(ROOT, "lib/wemark/code-themes-extra.ts");
  fs.writeFileSync(hljsOut, hljsFile);
  console.log(`✅ 代码高亮主题 ${HLJS_CONFIGS.length} 套 → ${path.relative(ROOT, hljsOut)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
