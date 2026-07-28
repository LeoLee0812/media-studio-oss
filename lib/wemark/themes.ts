/**
 * 主题系统：每个主题是一个函数，接收主题变量（主色、字号），
 * 返回「元素 → 内联 CSS」的映射表。渲染器在生成 HTML 时直接把这些
 * 样式写进 style 属性，保证复制到公众号后与预览完全一致。
 */
import { WENYAN_THEMES } from './themes-wenyan'

export interface ThemeVars {
  /** 主题色，如 #0F4C81 */
  primary: string
  /** 正文字号（px） */
  fontSize: number
}

/** 元素样式映射表：key 是渲染器约定的元素标识 */
export type StyleMap = Record<string, string>

export interface ThemeDef {
  id: string
  label: string
  desc: string
  styles: (v: ThemeVars) => StyleMap
}

/** 主色候选（公众号常见风格色） */
export const PRIMARY_COLORS = [
  { label: '经典蓝', value: '#0F4C81' },
  { label: '翡翠绿', value: '#009874' },
  { label: '活力橘', value: '#FA5151' },
  { label: '柠檬黄', value: '#B88230' },
  { label: '薰衣紫', value: '#92617E' },
  { label: '天空蓝', value: '#1E90FF' },
  { label: '玫瑰金', value: '#B76E79' },
  { label: '墨黑', value: '#333333' },
]

const TEXT = '#3f3f3f'
const TEXT_LIGHT = '#888888'

/* ==================== 经典主题 ==================== */
const classic: ThemeDef = {
  id: 'classic',
  label: '经典',
  desc: '居中标题 + 徽章式二级标题，doocs 风格',
  styles: ({ primary, fontSize: fs }) => ({
    container: `font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;font-size:${fs}px;color:${TEXT};line-height:1.75;letter-spacing:0.05em;text-align:left;word-break:break-word;`,
    h1: `display:table;margin:2em auto 1em;padding:0 1em;border-bottom:2px solid ${primary};color:#1f2937;font-size:${Math.round(fs * 1.35)}px;font-weight:bold;text-align:center;`,
    h2: `display:table;margin:3em auto 1.5em;padding:0.15em 0.6em;background:${primary};color:#fff;font-size:${Math.round(fs * 1.2)}px;font-weight:bold;text-align:center;border-radius:4px;`,
    h3: `margin:2em 8px 0.75em 0;padding-left:8px;border-left:3px solid ${primary};color:#1f2937;font-size:${Math.round(fs * 1.1)}px;font-weight:bold;line-height:1.3;`,
    h4: `margin:2em 8px 0.5em;color:${primary};font-size:${Math.round(fs * 1.05)}px;font-weight:bold;`,
    h5: `margin:1.5em 8px 0.5em;color:${primary};font-size:${fs}px;font-weight:bold;`,
    h6: `margin:1.5em 8px 0.5em;color:${primary};font-size:${fs}px;`,
    p: `margin:1.5em 8px;letter-spacing:0.1em;`,
    blockquote: `margin:1.5em 8px;padding:1em;border-left:4px solid ${primary};border-radius:6px;background:${primary}0f;color:${TEXT};`,
    blockquote_p: `margin:0;font-size:${fs}px;letter-spacing:0.1em;`,
    ul: `margin:1.5em 8px;padding-left:1.2em;list-style-type:disc;`,
    ol: `margin:1.5em 8px;padding-left:1.2em;list-style-type:decimal;`,
    li: `margin:0.4em 0;text-indent:0;`,
    code_inline: `margin:0 2px;padding:2px 5px;border-radius:4px;background:${primary}14;color:${primary};font-size:${Math.round(fs * 0.9)}px;font-family:Menlo,'Operator Mono',Consolas,Monaco,monospace;word-break:break-all;`,
    a: `color:${primary};text-decoration:none;border-bottom:1px solid ${primary}66;`,
    strong: `color:${primary};font-weight:bold;`,
    em: `font-style:italic;`,
    del: `color:${TEXT_LIGHT};text-decoration:line-through;`,
    hr: `margin:2em 8px;border:none;border-top:1px solid ${primary}4d;`,
    img: `display:block;max-width:100%;margin:0 auto;border-radius:6px;`,
    figure: `margin:1.5em 8px;`,
    figcaption: `margin-top:0.5em;color:${TEXT_LIGHT};font-size:${Math.round(fs * 0.85)}px;text-align:center;`,
    table: `margin:1.5em 8px;border-collapse:collapse;width:auto;max-width:100%;font-size:${Math.round(fs * 0.9)}px;overflow:auto;display:table;`,
    th: `padding:0.5em 1em;border:1px solid #dfdfdf;background:${primary}1a;color:#1f2937;font-weight:bold;text-align:left;`,
    td: `padding:0.5em 1em;border:1px solid #dfdfdf;text-align:left;`,
    footnotes_hr: `margin:3em 8px 1em;border:none;border-top:1px dashed ${primary}66;`,
    footnotes_title: `margin:0 8px 0.5em;color:${primary};font-size:${Math.round(fs * 0.95)}px;font-weight:bold;`,
    footnote_item: `margin:0.3em 8px;color:${TEXT_LIGHT};font-size:${Math.round(fs * 0.85)}px;word-break:break-all;`,
    sup: `color:${primary};font-size:${Math.round(fs * 0.75)}px;margin-left:2px;`,
  }),
}

/* ==================== 优雅主题 ==================== */
const elegant: ThemeDef = {
  id: 'elegant',
  label: '优雅',
  desc: '衬线字体 + 细线装饰，人文杂志风',
  styles: ({ primary, fontSize: fs }) => ({
    container: `font-family:Optima,'Optima-Regular',Georgia,'Noto Serif SC','Songti SC',serif;font-size:${fs}px;color:#40464f;line-height:1.9;letter-spacing:0.06em;text-align:left;word-break:break-word;`,
    h1: `margin:2.2em 8px 1em;color:#222;font-size:${Math.round(fs * 1.4)}px;font-weight:bold;text-align:center;letter-spacing:0.1em;`,
    h2: `display:table;margin:2.8em auto 1.4em;padding:0 0.3em 0.25em;border-bottom:2px solid ${primary};color:#222;font-size:${Math.round(fs * 1.25)}px;font-weight:bold;text-align:center;letter-spacing:0.08em;`,
    h3: `margin:2em 8px 0.8em;color:${primary};font-size:${Math.round(fs * 1.1)}px;font-weight:bold;letter-spacing:0.06em;`,
    h4: `margin:1.8em 8px 0.6em;color:#222;font-size:${Math.round(fs * 1.05)}px;font-weight:bold;`,
    h5: `margin:1.5em 8px 0.5em;color:${primary};font-size:${fs}px;font-weight:bold;`,
    h6: `margin:1.5em 8px 0.5em;color:${TEXT_LIGHT};font-size:${fs}px;`,
    p: `margin:1.6em 8px;text-align:justify;`,
    blockquote: `margin:1.8em 8px;padding:0.1em 1.2em;border-left:2px solid ${primary};color:#666;background:transparent;`,
    blockquote_p: `margin:1em 0;font-size:${fs}px;color:#666;`,
    ul: `margin:1.5em 8px;padding-left:1.4em;list-style-type:circle;`,
    ol: `margin:1.5em 8px;padding-left:1.4em;list-style-type:decimal;`,
    li: `margin:0.5em 0;`,
    code_inline: `margin:0 2px;padding:2px 5px;border-radius:3px;background:#f6f6f6;color:${primary};font-size:${Math.round(fs * 0.88)}px;font-family:Menlo,Consolas,Monaco,monospace;word-break:break-all;`,
    a: `color:${primary};text-decoration:none;border-bottom:1px dashed ${primary};`,
    strong: `color:#222;font-weight:bold;`,
    em: `font-style:italic;color:#555;`,
    del: `color:${TEXT_LIGHT};text-decoration:line-through;`,
    hr: `display:block;width:40%;margin:2.5em auto;border:none;border-top:1px solid #d8d8d8;`,
    img: `display:block;max-width:100%;margin:0 auto;border-radius:2px;`,
    figure: `margin:1.8em 8px;`,
    figcaption: `margin-top:0.6em;color:#999;font-size:${Math.round(fs * 0.82)}px;text-align:center;letter-spacing:0.05em;`,
    table: `margin:1.8em 8px;border-collapse:collapse;max-width:100%;font-size:${Math.round(fs * 0.9)}px;display:table;`,
    th: `padding:0.5em 1em;border-bottom:2px solid ${primary};color:#222;font-weight:bold;text-align:left;`,
    td: `padding:0.5em 1em;border-bottom:1px solid #e5e5e5;text-align:left;`,
    footnotes_hr: `display:block;width:100%;margin:3em auto 1em;border:none;border-top:1px solid #e0e0e0;`,
    footnotes_title: `margin:0 8px 0.5em;color:#222;font-size:${Math.round(fs * 0.95)}px;font-weight:bold;letter-spacing:0.1em;`,
    footnote_item: `margin:0.3em 8px;color:#999;font-size:${Math.round(fs * 0.82)}px;word-break:break-all;`,
    sup: `color:${primary};font-size:${Math.round(fs * 0.75)}px;margin-left:2px;`,
  }),
}

/* ==================== 极简主题 ==================== */
const minimal: ThemeDef = {
  id: 'minimal',
  label: '极简',
  desc: '无装饰、重留白，性冷淡风',
  styles: ({ primary, fontSize: fs }) => ({
    container: `font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue','PingFang SC','Microsoft YaHei',sans-serif;font-size:${fs}px;color:#353535;line-height:1.8;letter-spacing:0.03em;text-align:left;word-break:break-word;`,
    h1: `margin:2em 8px 1em;color:#111;font-size:${Math.round(fs * 1.4)}px;font-weight:700;`,
    h2: `margin:2.5em 8px 1.2em;color:#111;font-size:${Math.round(fs * 1.25)}px;font-weight:700;`,
    h3: `margin:2em 8px 0.8em;color:#111;font-size:${Math.round(fs * 1.1)}px;font-weight:600;`,
    h4: `margin:1.8em 8px 0.6em;color:#111;font-size:${Math.round(fs * 1.02)}px;font-weight:600;`,
    h5: `margin:1.5em 8px 0.5em;color:#333;font-size:${fs}px;font-weight:600;`,
    h6: `margin:1.5em 8px 0.5em;color:#666;font-size:${fs}px;font-weight:600;`,
    p: `margin:1.4em 8px;`,
    blockquote: `margin:1.5em 8px;padding:0.1em 1em;border-left:3px solid #e0e0e0;color:#777;`,
    blockquote_p: `margin:0.8em 0;font-size:${fs}px;color:#777;`,
    ul: `margin:1.4em 8px;padding-left:1.2em;list-style-type:disc;`,
    ol: `margin:1.4em 8px;padding-left:1.2em;list-style-type:decimal;`,
    li: `margin:0.4em 0;`,
    code_inline: `margin:0 2px;padding:2px 5px;border-radius:4px;background:#f5f5f5;color:#c0341d;font-size:${Math.round(fs * 0.88)}px;font-family:Menlo,Consolas,Monaco,monospace;word-break:break-all;`,
    a: `color:${primary};text-decoration:none;`,
    strong: `color:#111;font-weight:700;`,
    em: `font-style:italic;`,
    del: `color:#aaa;text-decoration:line-through;`,
    hr: `margin:2.5em 8px;border:none;border-top:1px solid #eee;`,
    img: `display:block;max-width:100%;margin:0 auto;border-radius:4px;`,
    figure: `margin:1.5em 8px;`,
    figcaption: `margin-top:0.5em;color:#aaa;font-size:${Math.round(fs * 0.82)}px;text-align:center;`,
    table: `margin:1.5em 8px;border-collapse:collapse;max-width:100%;font-size:${Math.round(fs * 0.9)}px;display:table;`,
    th: `padding:0.5em 1em;border:1px solid #eee;background:#fafafa;color:#111;font-weight:600;text-align:left;`,
    td: `padding:0.5em 1em;border:1px solid #eee;text-align:left;`,
    footnotes_hr: `margin:3em 8px 1em;border:none;border-top:1px solid #eee;`,
    footnotes_title: `margin:0 8px 0.5em;color:#111;font-size:${Math.round(fs * 0.95)}px;font-weight:600;`,
    footnote_item: `margin:0.3em 8px;color:#aaa;font-size:${Math.round(fs * 0.82)}px;word-break:break-all;`,
    sup: `color:${primary};font-size:${Math.round(fs * 0.75)}px;margin-left:2px;`,
  }),
}

/* ==================== 科技主题 ==================== */
const geek: ThemeDef = {
  id: 'geek',
  label: '科技',
  desc: '几何色块 + 高对比，科技媒体风',
  styles: ({ primary, fontSize: fs }) => ({
    container: `font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue','PingFang SC','Microsoft YaHei',sans-serif;font-size:${fs}px;color:#333;line-height:1.75;letter-spacing:0.04em;text-align:left;word-break:break-word;`,
    h1: `margin:2em 8px 1em;padding:0.4em 0.8em;background:linear-gradient(90deg,${primary}1f,transparent);border-left:5px solid ${primary};color:#111;font-size:${Math.round(fs * 1.35)}px;font-weight:bold;`,
    h2: `margin:2.6em 8px 1.3em;padding:0.3em 0.7em;background:linear-gradient(90deg,${primary}1a,transparent);border-left:4px solid ${primary};color:#111;font-size:${Math.round(fs * 1.2)}px;font-weight:bold;`,
    h3: `margin:2em 8px 0.8em;color:${primary};font-size:${Math.round(fs * 1.1)}px;font-weight:bold;`,
    h4: `margin:1.8em 8px 0.6em;color:#111;font-size:${Math.round(fs * 1.02)}px;font-weight:bold;`,
    h5: `margin:1.5em 8px 0.5em;color:${primary};font-size:${fs}px;font-weight:bold;`,
    h6: `margin:1.5em 8px 0.5em;color:#666;font-size:${fs}px;`,
    p: `margin:1.5em 8px;`,
    blockquote: `margin:1.5em 8px;padding:1em 1.2em;border-radius:8px;background:#f7f8fa;border-left:4px solid ${primary};color:#555;`,
    blockquote_p: `margin:0.3em 0;font-size:${fs}px;color:#555;`,
    ul: `margin:1.5em 8px;padding-left:1.2em;list-style-type:square;`,
    ol: `margin:1.5em 8px;padding-left:1.2em;list-style-type:decimal;`,
    li: `margin:0.45em 0;`,
    code_inline: `margin:0 2px;padding:2px 6px;border-radius:4px;background:#2d2d2d;color:#7ec699;font-size:${Math.round(fs * 0.86)}px;font-family:Menlo,Consolas,Monaco,monospace;word-break:break-all;`,
    a: `color:${primary};text-decoration:none;font-weight:500;border-bottom:1px solid ${primary};`,
    strong: `color:${primary};font-weight:bold;`,
    em: `font-style:italic;`,
    del: `color:#999;text-decoration:line-through;`,
    hr: `margin:2em 8px;border:none;height:2px;background:linear-gradient(90deg,${primary},transparent);`,
    img: `display:block;max-width:100%;margin:0 auto;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,0.08);`,
    figure: `margin:1.6em 8px;`,
    figcaption: `margin-top:0.6em;color:#999;font-size:${Math.round(fs * 0.82)}px;text-align:center;`,
    table: `margin:1.5em 8px;border-collapse:collapse;max-width:100%;font-size:${Math.round(fs * 0.9)}px;display:table;`,
    th: `padding:0.6em 1em;border:none;background:${primary};color:#fff;font-weight:bold;text-align:left;`,
    td: `padding:0.55em 1em;border-bottom:1px solid #eef0f2;background:#fbfcfd;text-align:left;`,
    footnotes_hr: `margin:3em 8px 1em;border:none;height:2px;background:linear-gradient(90deg,${primary}66,transparent);`,
    footnotes_title: `margin:0 8px 0.5em;color:${primary};font-size:${Math.round(fs * 0.95)}px;font-weight:bold;`,
    footnote_item: `margin:0.3em 8px;color:#999;font-size:${Math.round(fs * 0.82)}px;word-break:break-all;`,
    sup: `color:${primary};font-size:${Math.round(fs * 0.75)}px;margin-left:2px;`,
  }),
}

/** 4 套原生主题 + 7 套 wenyan 移植主题（见 themes-wenyan.ts 头注释的出处与协议） */
export const THEMES: ThemeDef[] = [classic, elegant, minimal, geek, ...WENYAN_THEMES]

export function getTheme(id: string): ThemeDef {
  return THEMES.find(t => t.id === id) ?? classic
}
