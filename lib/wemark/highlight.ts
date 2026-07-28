/**
 * 代码高亮内联化：用 highlight.js 生成带 hljs-* class 的 HTML，
 * 再把 class 替换成内联 style，保证复制进公众号后高亮不丢失。
 */
import hljs from 'highlight.js'
import { EXTRA_CODE_THEMES } from './code-themes-extra'

export interface CodeThemeDef {
  id: string
  label: string
  /** 代码块容器样式 */
  background: string
  color: string
  /** hljs token → 内联样式 */
  tokens: Record<string, string>
}

/* GitHub 浅色 */
const githubLight: CodeThemeDef = {
  id: 'github-light',
  label: 'GitHub 浅色',
  background: '#f6f8fa',
  color: '#24292e',
  tokens: {
    'keyword': 'color:#d73a49;',
    'built_in': 'color:#005cc5;',
    'type': 'color:#d73a49;',
    'literal': 'color:#005cc5;',
    'number': 'color:#005cc5;',
    'regexp': 'color:#032f62;',
    'string': 'color:#032f62;',
    'subst': 'color:#24292e;',
    'symbol': 'color:#e36209;',
    'class': 'color:#6f42c1;',
    'function': 'color:#6f42c1;',
    'title': 'color:#6f42c1;',
    'params': 'color:#24292e;',
    'comment': 'color:#6a737d;font-style:italic;',
    'doctag': 'color:#d73a49;',
    'meta': 'color:#6a737d;',
    'section': 'color:#005cc5;font-weight:bold;',
    'tag': 'color:#22863a;',
    'name': 'color:#22863a;',
    'attr': 'color:#005cc5;',
    'attribute': 'color:#005cc5;',
    'variable': 'color:#e36209;',
    'bullet': 'color:#735c0f;',
    'code': 'color:#032f62;',
    'emphasis': 'font-style:italic;',
    'strong': 'font-weight:bold;',
    'formula': 'color:#032f62;',
    'link': 'color:#032f62;text-decoration:underline;',
    'quote': 'color:#22863a;',
    'selector-tag': 'color:#22863a;',
    'selector-id': 'color:#6f42c1;',
    'selector-class': 'color:#6f42c1;',
    'selector-attr': 'color:#005cc5;',
    'selector-pseudo': 'color:#005cc5;',
    'template-tag': 'color:#d73a49;',
    'template-variable': 'color:#e36209;',
    'addition': 'color:#22863a;background:#f0fff4;',
    'deletion': 'color:#b31d28;background:#ffeef0;',
    'operator': 'color:#d73a49;',
    'property': 'color:#005cc5;',
    'punctuation': 'color:#24292e;',
    'char.escape_': 'color:#005cc5;',
  },
}

/* One Dark 深色 */
const oneDark: CodeThemeDef = {
  id: 'one-dark',
  label: 'One Dark 深色',
  background: '#282c34',
  color: '#abb2bf',
  tokens: {
    'keyword': 'color:#c678dd;',
    'built_in': 'color:#e6c07b;',
    'type': 'color:#e6c07b;',
    'literal': 'color:#56b6c2;',
    'number': 'color:#d19a66;',
    'regexp': 'color:#98c379;',
    'string': 'color:#98c379;',
    'subst': 'color:#e06c75;',
    'symbol': 'color:#61aeee;',
    'class': 'color:#e6c07b;',
    'function': 'color:#61aeee;',
    'title': 'color:#61aeee;',
    'params': 'color:#abb2bf;',
    'comment': 'color:#5c6370;font-style:italic;',
    'doctag': 'color:#c678dd;',
    'meta': 'color:#61aeee;',
    'section': 'color:#e06c75;font-weight:bold;',
    'tag': 'color:#e06c75;',
    'name': 'color:#e06c75;',
    'attr': 'color:#d19a66;',
    'attribute': 'color:#98c379;',
    'variable': 'color:#d19a66;',
    'bullet': 'color:#61aeee;',
    'code': 'color:#98c379;',
    'emphasis': 'font-style:italic;',
    'strong': 'font-weight:bold;',
    'formula': 'color:#98c379;',
    'link': 'color:#61aeee;text-decoration:underline;',
    'quote': 'color:#98c379;font-style:italic;',
    'selector-tag': 'color:#e06c75;',
    'selector-id': 'color:#61aeee;',
    'selector-class': 'color:#d19a66;',
    'selector-attr': 'color:#c678dd;',
    'selector-pseudo': 'color:#56b6c2;',
    'template-tag': 'color:#c678dd;',
    'template-variable': 'color:#d19a66;',
    'addition': 'color:#98c379;',
    'deletion': 'color:#e06c75;',
    'operator': 'color:#56b6c2;',
    'property': 'color:#d19a66;',
    'punctuation': 'color:#abb2bf;',
  },
}

/* Monokai */
const monokai: CodeThemeDef = {
  id: 'monokai',
  label: 'Monokai',
  background: '#272822',
  color: '#f8f8f2',
  tokens: {
    'keyword': 'color:#f92672;',
    'built_in': 'color:#66d9ef;',
    'type': 'color:#66d9ef;',
    'literal': 'color:#ae81ff;',
    'number': 'color:#ae81ff;',
    'regexp': 'color:#e6db74;',
    'string': 'color:#e6db74;',
    'subst': 'color:#f8f8f2;',
    'symbol': 'color:#66d9ef;',
    'class': 'color:#a6e22e;',
    'function': 'color:#a6e22e;',
    'title': 'color:#a6e22e;',
    'params': 'color:#fd971f;',
    'comment': 'color:#75715e;font-style:italic;',
    'doctag': 'color:#f92672;',
    'meta': 'color:#75715e;',
    'section': 'color:#a6e22e;font-weight:bold;',
    'tag': 'color:#f92672;',
    'name': 'color:#f92672;',
    'attr': 'color:#a6e22e;',
    'attribute': 'color:#a6e22e;',
    'variable': 'color:#fd971f;',
    'bullet': 'color:#66d9ef;',
    'code': 'color:#e6db74;',
    'emphasis': 'font-style:italic;',
    'strong': 'font-weight:bold;',
    'formula': 'color:#e6db74;',
    'link': 'color:#66d9ef;text-decoration:underline;',
    'quote': 'color:#75715e;font-style:italic;',
    'selector-tag': 'color:#f92672;',
    'selector-id': 'color:#a6e22e;',
    'selector-class': 'color:#a6e22e;',
    'selector-attr': 'color:#66d9ef;',
    'selector-pseudo': 'color:#66d9ef;',
    'template-tag': 'color:#f92672;',
    'template-variable': 'color:#fd971f;',
    'addition': 'color:#a6e22e;',
    'deletion': 'color:#f92672;',
    'operator': 'color:#f92672;',
    'property': 'color:#66d9ef;',
    'punctuation': 'color:#f8f8f2;',
  },
}

/** 3 套内置 + 6 套转换自 highlight.js 官方 CSS（见 code-themes-extra.ts） */
export const CODE_THEMES: CodeThemeDef[] = [githubLight, oneDark, monokai, ...EXTRA_CODE_THEMES]

export function getCodeTheme(id: string): CodeThemeDef {
  return CODE_THEMES.find(t => t.id === id) ?? githubLight
}

/**
 * 高亮一段代码并把 hljs class 全部替换为内联样式。
 * 返回可直接放进 <code> 的 HTML。
 */
export function highlightToInline(code: string, lang: string | undefined, theme: CodeThemeDef): string {
  let html: string
  try {
    if (lang && hljs.getLanguage(lang)) {
      html = hljs.highlight(code, { language: lang }).value
    } else {
      html = hljs.highlightAuto(code).value
    }
  } catch {
    html = escapeHtml(code)
  }

  // hljs 的 class 可能是 "hljs-title function_" 这类复合形式，逐个 token 匹配
  return html.replace(/class="([^"]*)"/g, (_m, cls: string) => {
    const names = (cls as string).split(/\s+/)
    for (const n of names) {
      const key = n.replace(/^hljs-/, '').replace(/_+$/, '')
      if (theme.tokens[key]) return `style="${theme.tokens[key]}"`
      // 处理 hljs-title.function_ 拆出的次级 class（如 function_、class_）
      const sub = key.replace(/\./g, '')
      if (theme.tokens[sub]) return `style="${theme.tokens[sub]}"`
    }
    return 'style=""'
  })
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
