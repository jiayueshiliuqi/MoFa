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

/**
 * 远程图片不自动加载：模型输出（尤其联网搜索/提示词注入场景）里的 ![](https://…)
 * 会让客户端立刻请求外部地址，从而把 IP 和「打开了这条消息」这一事实泄露给对方。
 * 这里渲染成占位按钮，用户主动点击才加载（MarkdownView 里处理点击）。
 */
md.renderer.rules.image = (tokens, idx, _options, env) => {
  const token = tokens[idx]
  const src = token.attrGet('src') ?? ''
  const alt = escapeHtml(token.content || '图片')
  // data: URL 是本应用自己产生的，可安全直接显示
  if (src.startsWith('data:image/')) {
    return `<img src="${escapeHtml(src)}" alt="${alt}" loading="lazy">`
  }
  if (!/^https?:\/\//i.test(src)) return `<span class="md-img-blocked">[图片：${alt}]</span>`
  return (
    `<button type="button" class="md-img-btn" data-src="${escapeHtml(src)}">` +
    `点击加载图片：${alt}` +
    `</button>`
  )
}

export function renderMarkdown(src: string, streaming = false): string {
  let html = md.render(src || '', { streaming })
  if (streaming) html += '<span class="stream-caret"></span>'
  return html
}
