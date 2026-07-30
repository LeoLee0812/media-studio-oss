/**
 * 渲染引擎：Markdown → 带内联样式的 HTML。
 * （移植自开源微信排版编辑器方案，Markdown 渲染为内联样式 HTML）
 *
 * 流程：marked 解析 → DOMParser 得到 DOM 树 → 结构变换
 * （代码块高亮、图片配字、链接转脚注、任务列表）→ 逐元素写入
 * 主题内联样式 → 包一层 <section> 输出。
 *
 * 只在浏览器端运行（依赖 DOMParser）。
 */
import { marked } from 'marked'
import { useCjkEmphasis } from '../marked-cjk'
import { getTheme, type StyleMap, type ThemeVars } from './themes'
import { getCodeTheme, highlightToInline } from './highlight'

export interface RenderOptions extends ThemeVars {
  themeId: string
  codeThemeId: string
  /** 代码块是否显示 Mac 风格红绿灯 */
  macCode: boolean
  /** 外部链接是否转为文末脚注（公众号会丢外链，建议开启） */
  linkToFootnote: boolean
}

export const DEFAULT_OPTIONS: RenderOptions = {
  themeId: 'classic',
  primary: '#0F4C81',
  fontSize: 15,
  codeThemeId: 'github-light',
  macCode: true,
  linkToFootnote: true,
}

marked.use({ gfm: true, breaks: true })
// 中文强调补丁：修「叫**中缝核（Raphe Nuclei）**的」这类紧邻中文的加粗配不上对、
// `**` 漏成字面量的问题（详见 lib/marked-cjk.ts）
useCjkEmphasis()

/** 给元素追加内联样式（保留已有样式，已有样式优先级更高） */
function addStyle(el: Element, css: string) {
  if (!css) return
  const prev = el.getAttribute('style') ?? ''
  el.setAttribute('style', css + prev)
}

function hasAncestor(el: Element, tags: string[]): boolean {
  let p = el.parentElement
  while (p) {
    if (tags.includes(p.tagName.toLowerCase())) return true
    p = p.parentElement
  }
  return false
}

/** 代码块 → 高亮 + 内联样式 + 可选 Mac 风格标题栏 */
function transformCodeBlocks(doc: Document, opts: RenderOptions) {
  const codeTheme = getCodeTheme(opts.codeThemeId)
  const fs = Math.round(opts.fontSize * 0.86)

  doc.querySelectorAll('pre > code').forEach((code) => {
    const pre = code.parentElement!
    const langMatch = /language-([\w+-]+)/.exec(code.className)
    const lang = langMatch?.[1]
    const raw = code.textContent ?? ''
    const inlined = highlightToInline(raw.replace(/\n$/, ''), lang, codeTheme)

    const wrap = doc.createElement('section')
    wrap.setAttribute(
      'style',
      `margin:1.5em 8px;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);`,
    )

    if (opts.macCode) {
      const bar = doc.createElement('section')
      bar.setAttribute(
        'style',
        `display:flex;align-items:center;padding:10px 14px 0;background:${codeTheme.background};`,
      )
      const colors = ['#ff5f56', '#ffbd2e', '#27c93f']
      for (const c of colors) {
        const dot = doc.createElement('span')
        dot.setAttribute(
          'style',
          `display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:8px;background:${c};`,
        )
        bar.appendChild(dot)
      }
      wrap.appendChild(bar)
    }

    const newPre = doc.createElement('pre')
    newPre.setAttribute(
      'style',
      `margin:0;padding:1em;background:${codeTheme.background};color:${codeTheme.color};overflow-x:auto;`,
    )
    const newCode = doc.createElement('code')
    newCode.setAttribute(
      'style',
      `display:block;font-family:Menlo,'Operator Mono',Consolas,Monaco,monospace;font-size:${fs}px;line-height:1.6;white-space:pre;background:transparent;color:${codeTheme.color};`,
    )
    newCode.innerHTML = inlined
    newPre.appendChild(newCode)
    wrap.appendChild(newPre)
    pre.replaceWith(wrap)
  })
}

/** 图片：独立成段的图片包成 figure，alt/title 作为图注 */
function transformImages(doc: Document, styles: StyleMap) {
  doc.querySelectorAll('img').forEach((img) => {
    const caption = img.getAttribute('title') || img.getAttribute('alt') || ''
    addStyle(img, styles.img)

    const p = img.parentElement
    const standalone =
      p?.tagName.toLowerCase() === 'p' &&
      p.childNodes.length <= 2 &&
      Array.from(p.childNodes).every(
        n => n === img || (n.nodeType === 3 && !n.textContent?.trim()) || n.nodeName === 'BR',
      )
    if (!standalone) return

    const figure = doc.createElement('figure')
    addStyle(figure, styles.figure)
    figure.appendChild(img)
    if (caption) {
      const figcaption = doc.createElement('figcaption')
      figcaption.textContent = caption
      addStyle(figcaption, styles.figcaption)
      figure.appendChild(figcaption)
    }
    p!.replaceWith(figure)
  })
}

/** 任务列表：input checkbox 在公众号会被剥掉，换成符号 */
function transformTaskLists(doc: Document) {
  doc.querySelectorAll('li > input[type="checkbox"]').forEach((input) => {
    const checked = input.hasAttribute('checked')
    const mark = doc.createElement('span')
    mark.textContent = checked ? '✅ ' : '⬜ '
    mark.setAttribute('style', 'margin-right:4px;')
    const li = input.parentElement!
    li.setAttribute('style', 'list-style-type:none;margin-left:-1.2em;')
    input.replaceWith(mark)
  })
}

/**
 * 链接处理：公众号只保留 mp.weixin.qq.com 域内链接，
 * 其余外链转成「正文标注 + 文末参考链接」。
 */
function transformLinks(doc: Document, styles: StyleMap, opts: RenderOptions) {
  const footnotes: { text: string; href: string }[] = []

  doc.querySelectorAll('a').forEach((a) => {
    const href = a.getAttribute('href') ?? ''
    const isExternal = /^https?:\/\//.test(href) && !href.startsWith('https://mp.weixin.qq.com')

    if (opts.linkToFootnote && isExternal) {
      const text = a.textContent ?? ''
      // 链接文字与地址相同时不重复记录文字
      footnotes.push({ text: text === href ? '' : text, href })
      const span = doc.createElement('span')
      span.setAttribute('style', styles.a)
      span.innerHTML = a.innerHTML
      const sup = doc.createElement('sup')
      sup.textContent = `[${footnotes.length}]`
      sup.setAttribute('style', styles.sup)
      a.replaceWith(span, sup)
    } else {
      addStyle(a, styles.a)
    }
  })

  if (footnotes.length) {
    const hr = doc.createElement('hr')
    hr.setAttribute('style', styles.footnotes_hr)
    const title = doc.createElement('p')
    title.textContent = '参考链接'
    title.setAttribute('style', styles.footnotes_title)
    doc.body.appendChild(hr)
    doc.body.appendChild(title)
    footnotes.forEach((f, i) => {
      const item = doc.createElement('p')
      item.setAttribute('style', styles.footnote_item)
      item.textContent = f.text ? `[${i + 1}] ${f.text}: ${f.href}` : `[${i + 1}] ${f.href}`
      doc.body.appendChild(item)
    })
  }
}

/** 主样式遍历：按标签把主题样式写进每个元素 */
function applyThemeStyles(doc: Document, styles: StyleMap) {
  const headings = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']

  doc.body.querySelectorAll('*').forEach((el) => {
    const tag = el.tagName.toLowerCase()

    switch (tag) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        addStyle(el, styles[tag])
        break
      case 'p':
        if (el.parentElement?.tagName.toLowerCase() === 'blockquote') {
          addStyle(el, styles.blockquote_p)
        } else if (!el.getAttribute('style')) {
          // 脚注区的 p 已带样式，跳过
          addStyle(el, styles.p)
        }
        break
      case 'blockquote':
        addStyle(el, styles.blockquote)
        break
      case 'ul': case 'ol':
        // 嵌套列表缩小外边距
        if (hasAncestor(el, ['li'])) {
          addStyle(el, styles[tag].replace(/margin:[^;]+;/, 'margin:0.4em 0;'))
        } else {
          addStyle(el, styles[tag])
        }
        break
      case 'li':
        addStyle(el, styles.li)
        break
      case 'code':
        // 行内代码（代码块里的 code 已在前面处理并自带样式）
        if (el.parentElement?.tagName.toLowerCase() !== 'pre' && !el.getAttribute('style')) {
          addStyle(el, styles.code_inline)
        }
        break
      case 'strong':
        // 标题里的加粗继承标题颜色，避免撞色
        if (hasAncestor(el, headings)) {
          addStyle(el, 'font-weight:bold;color:inherit;')
        } else {
          addStyle(el, styles.strong)
        }
        break
      case 'em':
        addStyle(el, styles.em)
        break
      case 'del':
        addStyle(el, styles.del)
        break
      case 'hr':
        if (!el.getAttribute('style')) addStyle(el, styles.hr)
        break
      case 'table':
        addStyle(el, styles.table)
        break
      case 'th':
        addStyle(el, styles.th)
        break
      case 'td':
        addStyle(el, styles.td)
        break
      case 'figure':
        if (!el.getAttribute('style')) addStyle(el, styles.figure)
        break
      case 'img':
        if (!el.getAttribute('style')) addStyle(el, styles.img)
        break
    }
  })

  // 表格外包一层可横向滚动的容器，防止公众号里溢出
  doc.body.querySelectorAll('table').forEach((table) => {
    const scroll = doc.createElement('section')
    scroll.setAttribute('style', 'overflow-x:auto;margin:0;')
    table.replaceWith(scroll)
    scroll.appendChild(table)
  })
}

/** 渲染入口 */
export function renderMarkdown(md: string, opts: RenderOptions): string {
  const theme = getTheme(opts.themeId)
  const styles = theme.styles({ primary: opts.primary, fontSize: opts.fontSize })

  const rawHtml = marked.parse(md, { async: false }) as string
  const doc = new DOMParser().parseFromString(rawHtml, 'text/html')

  transformCodeBlocks(doc, opts)
  transformImages(doc, styles)
  transformTaskLists(doc)
  transformLinks(doc, styles, opts)
  applyThemeStyles(doc, styles)

  const section = doc.createElement('section')
  section.setAttribute('id', 'wemark-output')
  section.setAttribute('data-tool', 'WeMark 微信 Markdown 编辑器')
  section.setAttribute('style', styles.container)
  while (doc.body.firstChild) section.appendChild(doc.body.firstChild)

  return section.outerHTML
}

// ── 可写模式：逐块渲染（media-studio 侧新增，WeMark 那边没有这一段）────────────
// 预览要「点哪块改哪块」，就得知道每个渲染块对应哪段 Markdown 源。
// 做法：先用 marked.lexer 把正文切成顶层 token（heading/paragraph/list/code/table…），
// 每个 token 单独 parser 一次拿到它自己的 HTML 片段（实测与整体 parse 结果逐字一致，
// 且所有 token 的 raw 拼起来正好等于原文，所以块与源码是严格一一对应的），
// 再套一层 <div data-md-block="i"> 外壳一起走同一条 transform 流水线（样式与
// renderMarkdown 完全一致），最后按外壳把 HTML 拆回数组。
//
// 外壳只服务预览 DOM：复制到公众号/小红书/推特仍走 renderMarkdown 的整段输出，
// 剪贴板里不会多出这层 div。

/** 单个可编辑块：Markdown 源 + 它渲染出的 HTML */
export interface BlockRender {
  raw: string
  html: string
}

export interface BlocksRender {
  /** 外层容器的内联样式（字体/字号/行高，与 renderMarkdown 的 section 同一份） */
  containerStyle: string
  blocks: BlockRender[]
  /** 尾部附加内容（「参考链接」脚注区），不属于任何块，只读 */
  tailHtml: string
}

export function renderMarkdownBlocks(md: string, opts: RenderOptions): BlocksRender {
  const theme = getTheme(opts.themeId)
  const styles = theme.styles({ primary: opts.primary, fontSize: opts.fontSize })

  const raws: string[] = []
  let wrapped = ''
  for (const token of marked.lexer(md)) {
    // space token 只是块之间的空行，没有可编辑内容
    if (token.type === 'space') continue
    const raw = (token.raw ?? '').replace(/\s+$/, '')
    if (!raw.trim()) continue
    // 缩进代码块（4 空格起，非 ``` 围栏）在中文稿里几乎都是正文误缩进：
    // 复制链路的 reflowProse 会把缩进吃掉当正文渲染，这里跟着当正文，
    // 否则可写模式会凭空多出一块「代码」，与只读预览和复制结果都不一致。
    // 只影响渲染，块的 raw 仍是原文（含缩进），编辑写回照旧对得上位置。
    const indentedProse = token.type === 'code' && !/^\s{0,3}(```|~~~)/.test(raw)
    const frag = indentedProse
      ? (marked.parse(raw.replace(/^[ \t]+/gm, ''), { async: false }) as string)
      : (marked.parser([token], { async: false }) as string)
    wrapped += `<div data-md-block="${raws.length}">${frag}</div>`
    raws.push(raw)
  }

  const doc = new DOMParser().parseFromString(wrapped, 'text/html')

  transformCodeBlocks(doc, opts)
  transformImages(doc, styles)
  transformTaskLists(doc)
  transformLinks(doc, styles, opts)
  applyThemeStyles(doc, styles)

  const blocks: BlockRender[] = raws.map((raw) => ({ raw, html: '' }))
  let tailHtml = ''
  for (const el of Array.from(doc.body.children)) {
    const idx = el.getAttribute('data-md-block')
    const block = idx === null ? undefined : blocks[Number(idx)]
    if (block) block.html = el.innerHTML
    else tailHtml += el.outerHTML // 脚注区等
  }

  return { containerStyle: styles.container, blocks, tailHtml }
}

/** 字数统计（中文按字、英文按词） */
export function countWords(md: string): number {
  const cjk = (md.match(/[一-鿿㐀-䶿]/g) ?? []).length
  const words = (md.replace(/[一-鿿㐀-䶿]/g, ' ').match(/[a-zA-Z0-9]+/g) ?? []).length
  return cjk + words
}
