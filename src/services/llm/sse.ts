/** 通用 SSE 读取器：逐 `data:` 行回调。三个协议适配器共用。 */
export interface SseReadResult {
  /** 是否读到协议的结束标记（OpenAI 的 [DONE]） */
  sawDone: boolean
}

export interface SseReadOptions {
  /** 空闲超时（毫秒）：超过该时间没有任何新数据即中断，防止服务端挂起导致永久「生成中」 */
  idleTimeoutMs?: number
  /** 外部中止信号 */
  signal?: AbortSignal
}

export async function readSseStream(
  res: Response,
  onData: (data: string) => void,
  opts: SseReadOptions = {},
): Promise<SseReadResult> {
  if (!res.body) throw new Error('当前环境不支持流式响应（res.body 为空）')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let sawDone = false
  const idleMs = opts.idleTimeoutMs ?? 120_000
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let timedOut = false

  /** 重置空闲计时器；超时则取消底层流，让挂起的 read() 立刻返回 */
  const kickIdle = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      timedOut = true
      void reader.cancel().catch(() => undefined)
    }, idleMs)
  }

  const onAbort = () => {
    void reader.cancel().catch(() => undefined)
  }
  opts.signal?.addEventListener('abort', onAbort, { once: true })

  const processLine = (raw: string) => {
    const s = raw.trim()
    if (!s.startsWith('data:')) return
    const data = s.slice(5).trim()
    if (!data) return
    if (data === '[DONE]') {
      sawDone = true
      return
    }
    onData(data)
  }

  try {
    kickIdle()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      kickIdle()
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) processLine(line)
    }
    // 主动停止：部分实现里 cancel() 会让挂起的 read() 正常返回 done，
    // 这里统一转成 AbortError，保证上层能走「保留已生成内容」的分支
    if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    if (timedOut) {
      throw new Error(`响应超时：${Math.round(idleMs / 1000)} 秒未收到新数据`)
    }

    // 收尾：冲刷 decoder（流末尾被切的多字节字符）与无换行结尾的残留行
    buffer += decoder.decode()
    for (const line of buffer.split('\n')) processLine(line)
    return { sawDone }
  } catch (e) {
    // 回调抛错（服务端流内报错）时主动断开，避免连接一直被占用
    void reader.cancel().catch(() => undefined)
    throw e
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
    opts.signal?.removeEventListener('abort', onAbort)
    try {
      reader.releaseLock()
    } catch {
      /* 已取消时可能抛错，忽略 */
    }
  }
}
