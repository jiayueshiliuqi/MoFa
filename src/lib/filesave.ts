/**
 * 把模型输出保存为真实文件：
 * - 原生端：写入应用缓存目录后用系统分享面板（可选保存到下载/文件管理器/发送给别人）。
 *   WebView 不支持 navigator.share 与 blob 下载，必须走 Capacitor 插件。
 * - Web/PWA：navigator.share 优先，不支持则浏览器下载。
 * Word 生成用 docx 库懒加载，在本地打包真正的 .docx。
 */
import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

function timestamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** 代码语言 → 文件扩展名 */
export function langToExt(lang: string): string {
  const map: Record<string, string> = {
    javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', tsx: 'tsx', jsx: 'jsx',
    json: 'json', json5: 'json5', python: 'py', py: 'py', bash: 'sh', shell: 'sh',
    sh: 'sh', zsh: 'sh', html: 'html', css: 'css', scss: 'scss', less: 'less',
    java: 'java', c: 'c', cpp: 'cpp', 'c++': 'cpp', csharp: 'cs', 'c#': 'cs',
    go: 'go', golang: 'go', rust: 'rs', rs: 'rs', ruby: 'rb', php: 'php',
    sql: 'sql', yaml: 'yaml', yml: 'yaml', xml: 'xml', md: 'md', markdown: 'md',
    kotlin: 'kt', kt: 'kt', swift: 'swift', vue: 'vue', dart: 'dart', txt: 'txt',
  }
  return map[lang.toLowerCase().trim()] ?? 'txt'
}

export function snippetName(lang: string): string {
  return `snippet-${timestamp()}.${langToExt(lang)}`
}

export function docName(base: string, ext: string): string {
  return `${base.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)}-${timestamp()}.${ext}`
}

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer())
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

/** 保存文件：原生端 Filesystem+Share，Web 端分享优先、下载兜底；用户取消返回 'cancelled' */
export async function shareOrDownload(file: File): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (Capacitor.isNativePlatform()) {
    // 先写入缓存目录（同名覆盖，避免越攒越多），再拉起系统分享
    const data = await fileToBase64(file)
    const saved = await Filesystem.writeFile({
      path: file.name,
      data,
      directory: Directory.Cache,
      recursive: true,
    })
    try {
      await Share.share({ title: file.name, url: saved.uri })
    } catch (e) {
      // 安卓分享面板取消时部分实现会 reject「Share canceled」
      if (e instanceof Error && /cancel/i.test(e.message)) return 'cancelled'
      throw e
    }
    return 'shared'
  }
  // 分享优先：桌面浏览器没有分享目标、权限被拒时不能直接失败，要退回下载
  let canShareFiles = false
  try {
    canShareFiles = !!navigator.canShare?.({ files: [file] })
  } catch {
    canShareFiles = false
  }
  if (canShareFiles) {
    try {
      await navigator.share({ files: [file], title: file.name })
      return 'shared'
    } catch (e) {
      // 用户在系统分享面板点取消不算失败
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
      // 其余（NotAllowedError / 无可用分享目标等）落到下面的下载兜底
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return 'downloaded'
}

export function saveTextFile(content: string, filename: string, mime = 'text/plain'): File {
  return new File([content], filename, { type: mime })
}

/** 轻量去掉 markdown 修饰，得到可读纯文本（用于 .txt） */
export function mdToPlain(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/^```.*\n?/gm, '').replace(/```$/g, ''))
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1（$2）')
    .trim()
}

/** markdown → 真实 .docx（标题/列表/引用/代码块/加粗保留；表格降级为文本行） */
export async function mdToDocxFile(md: string, filename: string): Promise<File> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx')

  const inlineRuns = (text: string, mono: boolean): InstanceType<typeof TextRun>[] => {
    if (mono) return [new TextRun({ text, font: 'Courier New', size: 20 })]
    const runs: InstanceType<typeof TextRun>[] = []
    for (const seg of text.split(/(\*\*[^*]+\*\*)/g)) {
      if (!seg) continue
      if (seg.startsWith('**') && seg.endsWith('**')) {
        runs.push(new TextRun({ text: seg.slice(2, -2), bold: true }))
      } else {
        runs.push(new TextRun({ text: seg.replace(/`([^`]+)`/g, '$1') }))
      }
    }
    return runs.length ? runs : [new TextRun({ text: '' })]
  }

  const paras: InstanceType<typeof Paragraph>[] = []
  let inCode = false
  for (const line of md.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      inCode = !inCode
      continue
    }
    const mono = inCode
    if (!mono) {
      const h = /^(#{1,4})\s+(.*)$/.exec(line)
      if (h) {
        const levels = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4]
        paras.push(new Paragraph({ heading: levels[h[1].length - 1], children: inlineRuns(h[2], false) }))
        continue
      }
      const ul = /^\s*[-*]\s+(.*)$/.exec(line)
      if (ul) {
        paras.push(new Paragraph({ bullet: { level: 0 }, children: inlineRuns(ul[1], false) }))
        continue
      }
      const ol = /^\s*\d+[.、]\s+(.*)$/.exec(line)
      if (ol) {
        // 保留原行自带的序号文本（不同列表各自从 1 开始，避免共享编号器跨列表累加）
        paras.push(new Paragraph({ children: inlineRuns(line.trim(), false) }))
        continue
      }
      const quote = /^>\s?(.*)$/.exec(line)
      if (quote) {
        paras.push(new Paragraph({ children: inlineRuns(quote[1], false), indent: { left: 360 }, border: { left: { style: 'single', size: 12, color: 'BBBBBB' } } }))
        continue
      }
      if (!line.trim()) {
        paras.push(new Paragraph({ children: [] }))
        continue
      }
    }
    paras.push(new Paragraph({ children: inlineRuns(line.replace(/\s+/g, ' ').trim() || ' ', mono) }))
  }

  const doc = new Document({
    sections: [{ children: paras }],
  })
  const blob = await Packer.toBlob(doc)
  return new File([blob], filename, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
}
