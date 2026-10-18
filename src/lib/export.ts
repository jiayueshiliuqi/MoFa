/** 对话导出：生成 Markdown 并通过系统分享 / 浏览器下载 */
import { shareOrDownload } from './filesave'

interface ExportMessage {
  role: 'user' | 'assistant'
  content: string
  model?: string
  images?: string[]
  files?: Array<{ name: string }>
}

export function conversationToMarkdown(
  conv: { title: string; systemPrompt?: string },
  msgs: ExportMessage[],
): string {
  // 标题里的换行会破坏 Markdown 结构（可注入额外标题/分隔线），导出时压成单行
  const title = conv.title.replace(/[\r\n]+/g, ' ').trim() || '对话'
  const lines: string[] = [`# ${title}`, '']
  if (conv.systemPrompt?.trim()) {
    // 多行系统提示词逐行加引用前缀，否则后续行会脱离引用块
    for (const line of conv.systemPrompt.trim().split(/\r?\n/)) lines.push(`> ${line}`)
    lines.push('')
  }
  for (const m of msgs) {
    if (m.role === 'user') {
      lines.push('## 🧑 我', '')
      if (m.files?.length) {
        lines.push(`（附件：${m.files.map((f) => f.name).join('、')}）`, '')
      }
      if (m.images?.length) {
        lines.push(`（图片 ×${m.images.length}）`, '')
      }
      lines.push(m.content, '')
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
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const md = conversationToMarkdown(conv, msgs)
  const file = new File([md], safeFilename(conv.title), { type: 'text/markdown' })
  // 与「存为文件」共用同一链路：原生端 Filesystem+Share（WebView 不支持 navigator.share 与 blob 下载）
  return shareOrDownload(file)
}

/** 文件名清洗：非法字符 + 控制字符 + 超长（Android 文件系统上限 255 字节）+ 空标题 */
export function safeFilename(title: string, ext = 'md'): string {
  const base =
    title
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, 60)
      .trim() || '对话'
  return `${base}.${ext}`
}
