import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/common'

/**
 * Markdown 渲染管线：
 * - markdown-it 解析（breaks: 聊天场景下单换行即换行）
 * - highlight.js 代码高亮（common 子集，包体可控）
 * - 代码块包装成带「语言标签 + 复制按钮」头部的结构，复制走事件委托（见 MarkdownView.vue）
 */
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
})

function escapeHtml(str: string): string {
  return md.utils.escapeHtml(str)
}

// 自定义 fence 渲染：带头部栏的代码块
md.renderer.rules.fence = (tokens, idx, _options, env) => {
  const token = tokens[idx]
  const lang = (token.info || '').trim().split(/\s+/)[0]
  // 流式增量渲染时跳过 highlight.js（长回复里最大的渲染开销）：
  // 结束时 streaming 翻转会触发最终一次完整渲染，届时补上高亮
  const canHighlight = !!lang && hljs.getLanguage(lang)
  const highlighted =
    canHighlight && env?.streaming !== true
      ? hljs.highlight(token.content, { language: lang, ignoreIllegals: true }).value
      : escapeHtml(token.content)
  const encoded = encodeURIComponent(token.content)
  return (
    `<div class="code-block">` +
    `<div class="code-block-head">` +
    `<span class="code-lang">${escapeHtml(lang || 'text')}</span>` +
    `<button class="code-copy code-save" type="button" data-lang="${escapeHtml(lang)}" data-code="${encoded}">保存</button>` +
    `<button class="code-copy" type="button" data-code="${encoded}">复制</button>` +
    `</div>` +
    `<pre class="code-block-pre"><code class="hljs">${highlighted}</code></pre>` +
    `</div>\n`
  )
}

// 外链新窗口打开
const defaultLinkOpen =
  md.renderer.rules.link_open ||
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const attrs = token.attrs ?? (token.attrs = [])
  const aIndex = attrs.findIndex((a) => a[0] === 'target')
  if (aIndex < 0) attrs.push(['target', '_blank'])
  else attrs[aIndex][1] = '_blank'
  attrs.push(['rel', 'noopener noreferrer'])
  return defaultLinkOpen(tokens, idx, options, env, self)
}

export function renderMarkdown(src: string, streaming = false): string {
  let html = md.render(src || '', { streaming })
  if (streaming) html += '<span class="stream-caret"></span>'
  return html
}
