/** 对话导出：生成 Markdown 并通过系统分享 / 浏览器下载 */

interface ExportMessage {
  role: 'user' | 'assistant'
  content: string
  model?: string
}

export function conversationToMarkdown(
  conv: { title: string; systemPrompt?: string },
  msgs: ExportMessage[],
): string {
  const lines: string[] = [`# ${conv.title}`, '']
  if (conv.systemPrompt?.trim()) {
    lines.push(`> 助手设定：${conv.systemPrompt.trim()}`, '')
  }
  for (const m of msgs) {
    if (m.role === 'user') {
      lines.push('## 🧑 我', '', m.content, '')
    } else {
      const tag = m.model ? `MoFa · ${m.model}` : 'MoFa'
      lines.push(`## 🤖 ${tag}`, '', m.content, '')
    }
  }
  lines.push('---', '', `导出自 MoFa · ${new Date().toLocaleString('zh-CN')}`)
  return lines.join('\n')
}

export async function exportConversation(
  conv: { title: string; systemPrompt?: string },
  msgs: ExportMessage[],
): Promise<'shared' | 'downloaded'> {
  const md = conversationToMarkdown(conv, msgs)
  const filename = `${conv.title.replace(/[\\/:*?"<>|]/g, '_')}.md`
  const file = new File([md], filename, { type: 'text/markdown' })

  // 优先系统分享（真机上体验最好），不支持则回退为浏览器下载
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: conv.title })
    return 'shared'
  }

  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return 'downloaded'
}
