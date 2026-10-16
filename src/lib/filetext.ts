/**
 * 附件文本提取：全部在客户端转成纯文本注入，不依赖模型的多模态能力（全厂商兼容）。
 * PDF（pdf.js）与 Word（mammoth）按需懒加载，不拖累主包体积。
 */
export const MAX_FILE_CHARS = 12000
export const MAX_MESSAGE_FILE_CHARS = 36000

const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'xml', 'yml', 'yaml',
  'html', 'htm', 'css', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'vue', 'svelte',
  'py', 'java', 'kt', 'kts', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'rb',
  'php', 'sh', 'bash', 'bat', 'ps1', 'sql', 'ini', 'toml', 'conf', 'env',
  'properties', 'gradle', 'swift', 'dart', 'r', 'm', 'pl', 'lua',
])

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

function truncate(text: string): string {
  if (text.length <= MAX_FILE_CHARS) return text
  const cut = text.slice(0, MAX_FILE_CHARS)
  // UTF-16 安全：不切断代理对（emoji 等）
  const code = cut.charCodeAt(cut.length - 1)
  return (code >= 0xd800 && code <= 0xdbff ? cut.slice(0, -1) : cut) + '\n…（内容过长，已截断）'
}

/** 提取文件文本；不支持的类型抛错（调用方 toast 提示） */
export async function extractFileText(file: File): Promise<string> {
  const e = extOf(file.name)
  const type = file.type || ''
  if (e === 'pdf' || type === 'application/pdf') return truncate(await pdfToText(file))
  if (e === 'docx' || type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    return truncate(await docxToText(file))
  if (e === 'doc') throw new Error('暂不支持旧版 .doc，请另存为 .docx')
  if (TEXT_EXT.has(e) || type.startsWith('text/')) return truncate(await readAsText(file))
  // 无扩展名且无类型：按文本尝试（二进制会被防护拦下）
  if (!e && !type) return truncate(await readAsText(file))
  throw new Error('暂不支持该文件类型')
}

async function readAsText(file: File): Promise<string> {
  // UTF-8 优先；替换符占比过高时按 GBK 重试（Windows 中文环境常见的 ANSI 编码）
  const buf = await file.arrayBuffer()
  let text = new TextDecoder('utf-8').decode(buf)
  const bad = (text.match(/\uFFFD/g) ?? []).length
  if (bad > 0 && bad / Math.max(text.length, 1) > 0.01) {
    try {
      const gbk = new TextDecoder('gbk').decode(buf)
      if ((gbk.match(/\uFFFD/g) ?? []).length < bad) text = gbk
    } catch {
      /* 环境不支持 GBK 解码则保持 UTF-8 结果 */
    }
  }
  // 二进制误判防护：文本里不该有空字节
  if (text.includes('\u0000')) throw new Error('看起来是二进制文件，无法提取文本')
  return text
}

async function pdfToText(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.js?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  // 提取完销毁文档，释放 worker 与页面缓存（连续附加多个 PDF 时不涨内存）
  try {
    const pages = Math.min(doc.numPages, 40)
    let out = ''
    for (let p = 1; p <= pages; p++) {
      const content = await (await doc.getPage(p)).getTextContent()
      for (const item of content.items) {
        if ('str' in item) out += item.str + (item.hasEOL ? '\n' : ' ')
      }
      out += '\n'
      if (out.length > MAX_FILE_CHARS) break
    }
    if (!out.trim()) throw new Error('PDF 中没有可提取的文字（可能是扫描件）')
    return out
  } finally {
    await doc.destroy()
  }
}

async function docxToText(file: File): Promise<string> {
  const mammoth = (await import('mammoth')).default
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
  if (!value.trim()) throw new Error('Word 文档中没有文字')
  return value
}
