import type { ListModelsParams, LlmAdapter, StreamChatParams } from './types'
import { readSseStream } from './sse'

/**
 * OpenAI 兼容协议适配器 —— Cherry Studio 模式的主力，覆盖 90% 的服务商
 * （DeepSeek / OpenAI / 硅基流动 / OpenRouter / Moonshot / GLM / Ollama / Gemini 兼容端点 …）。
 */

/** 规范化 base URL：路径中已有版本段（/v1、/v1beta 等）就不补，否则补 /v1 */
export function normalizeBase(base: string): string {
  let b = base.trim().replace(/\/+$/, '')
  // Gemini 的 OpenAI 兼容端点（…/v1beta/openai）等"版本段不在末尾"的地址不能重复补 /v1
  if (!/\/v\d+[a-z]*(\/|$)/.test(b)) b += '/v1'
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
      throw new Error(`请求失败 ${res.status} ${await readError(res)}`)
    }

    let full = ''
    await readSseStream(res, (data) => {
      let json: unknown
      try {
        json = JSON.parse(data)
      } catch {
        return // 忽略无法解析的行（如部分网关的心跳注释）
      }
      const obj = json as { error?: { message?: string } }
      // 部分网关（OpenRouter 等）在流内以 {"error":…} 事件报错，必须抛出而不是静默结束
      if (obj?.error) {
        throw new Error(obj.error.message || '服务端在流中返回错误')
      }
      const delta = (json as { choices?: Array<{ delta?: { content?: string; reasoning_content?: string; reasoning?: string } }> })
        ?.choices?.[0]?.delta
      if (!delta) return
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
    })

    return full
  },

  async listModels({ baseURL, apiKey }: ListModelsParams) {
    const res = await fetch(`${normalizeBase(baseURL)}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) {
      throw new Error(`连接失败 ${res.status} ${await readError(res)}`)
    }
    const json = await res.json()
    const list: string[] = (json?.data ?? []).map((m: { id: string }) => m.id)
    return list.sort()
  },
}
