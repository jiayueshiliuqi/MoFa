/** 通用 SSE 读取器：逐 `data:` 行回调。三个协议适配器共用。 */
export async function readSseStream(res: Response, onData: (data: string) => void): Promise<void> {
  if (!res.body) throw new Error('当前环境不支持流式响应（res.body 为空）')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const processLine = (raw: string) => {
    const s = raw.trim()
    if (!s.startsWith('data:')) return
    const data = s.slice(5).trim()
    if (!data || data === '[DONE]') return
    onData(data)
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) processLine(line)
  }

  // 收尾：冲刷 decoder（流末尾被切的多字节字符）与无换行结尾的残留行
  buffer += decoder.decode()
  for (const line of buffer.split('\n')) processLine(line)
}
