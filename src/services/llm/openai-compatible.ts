import type { ListModelsParams, LlmAdapter, StreamChatParams } from './types'

/**
 * OpenAI 兼容协议适配器 —— Cherry Studio 模式的主力，覆盖 90% 的服务商
 * （DeepSeek / OpenAI / 硅基流动 / OpenRouter / Moonshot / GLM / Ollama …）。
 *
 * 流式说明：直接用 WebView 原生 fetch + ReadableStream（Capacitor 需保持
 * CapacitorHttp 补丁关闭，见 capacitor.config 与 README）。若真机上个别机型
 * 不支持流式，兜底方案是接入 chatboxai/capacitor-stream-http 原生插件。
 */

/** 规范化 base URL：补 /v1（若没有），去尾部斜杠 */
export function normalizeBase(base: string): string {
  let b = base.trim().replace(/\/+$/, '')
  if (!/\/v\d+([a-z]*)?$/.test(b)) b += '/v1'
  return b
}

async function readError(res: Response): Promise<string> {
  let detail = ''
  try {
    const text = await res.text()
    try {
      const json = JSON.parse(text)
      detail = json?.error?.message || json?.message || text
    } catch {
      detail = text
    }
  } catch {
    /* ignore */
  }
  detail = (detail || '').slice(0, 300)
  return detail ? `（${detail}）` : ''
}

export const openaiCompatible: LlmAdapter = {
  async streamChat({ baseURL, apiKey, model, messages, thinkingEffort, signal, onChunk }: StreamChatParams) {
    // 思考强度：off 走国产生态通用开关；low/medium/high 走 OpenAI 标准的 reasoning_effort
    const thinkingParams =
      thinkingEffort === 'off'
        ? { enable_thinking: false }
        : thinkingEffort === 'low' || thinkingEffort === 'medium' || thinkingEffort === 'high'
          ? { reasoning_effort: thinkingEffort }
          : {}

    const res = await fetch(`${normalizeBase(baseURL)}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        ...thinkingParams,
      }),
      signal,
    })

    if (!res.ok) {
      throw new Error(`请求失败 ${res.status} ${readError(res)}`)
    }
    if (!res.body) {
      throw new Error('当前环境不支持流式响应（res.body 为空）')
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let full = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const s = line.trim()
        if (!s || !s.startsWith('data:')) continue
        const data = s.slice(5).trim()
        if (data === '[DONE]') continue
        try {
          const json = JSON.parse(data)
          const delta = json?.choices?.[0]?.delta
          if (!delta) continue
          // 思考过程：reasoning_content（DeepSeek/Qwen/SiliconFlow）或 reasoning（部分网关）
          const reasoning =
            typeof delta.reasoning_content === 'string' ? delta.reasoning_content : undefined
          if (reasoning) {
            onChunk(reasoning, 'reasoning')
          } else if (typeof delta.reasoning === 'string' && delta.reasoning) {
            onChunk(delta.reasoning, 'reasoning')
          }
          if (typeof delta.content === 'string' && delta.content) {
            full += delta.content
            onChunk(delta.content, 'content')
          }
        } catch {
          // 忽略无法解析的行（如部分网关的心跳注释）
        }
      }
    }

    return full
  },

  async listModels({ baseURL, apiKey }: ListModelsParams) {
    const res = await fetch(`${normalizeBase(baseURL)}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) {
      throw new Error(`连接失败 ${res.status} ${readError(res)}`)
    }
    const json = await res.json()
    const list: string[] = (json?.data ?? []).map((m: { id: string }) => m.id)
    return list.sort()
  },
}
