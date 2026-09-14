import type { ListModelsParams, LlmAdapter, StreamChatParams } from './types'
import type { LlmMessage, ThinkingEffort } from './types'
import { readSseStream } from './sse'

/**
 * Anthropic Messages API 适配器（Claude 官方协议）。
 * - 认证：x-api-key 头（非 Bearer）
 * - 浏览器/WebView 直连需带 anthropic-dangerous-direct-browser-access
 * - SSE 事件：content_block_delta（text_delta=正文，thinking_delta=思考）
 */

/** 从 data URL 解析出 mime 和 base64 数据（图片多模态用） */
export function parseDataUrl(dataUrl: string): { mime: string; data: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl)
  return m ? { mime: m[1], data: m[2] } : null
}

function apiUrl(base: string, path: string): string {
  const b = base.trim().replace(/\/+$/, '')
  // 用户可能填了 /v1 也可能没填，统一归一到 …/v1/xxx
  return b.endsWith('/v1') ? `${b}${path.replace(/^\/v1/, '')}` : `${b}${path}`
}

/** 思考强度 → Claude 的 thinking budget（tokens） */
function thinkingBudget(effort: ThinkingEffort | undefined): number | null {
  if (effort === 'low') return 2048
  if (effort === 'medium') return 8192
  if (effort === 'high') return 16384
  return null // default/off 都不主动开启
}

function toAnthropicBody(
  messages: LlmMessage[],
  model: string,
  effort: ThinkingEffort | undefined,
): Record<string, unknown> {
  let system: string | undefined
  const contents: Array<{ role: 'user' | 'assistant'; content: unknown }> = []

  for (const m of messages) {
    if (m.role === 'system') {
      if (typeof m.content === 'string') system = m.content
      continue
    }
    let content: unknown
    if (typeof m.content === 'string') {
      content = m.content
    } else {
      // 多模态分片 → Anthropic content blocks
      const blocks: Array<Record<string, unknown>> = []
      for (const part of m.content) {
        if (part.type === 'text') {
          blocks.push({ type: 'text', text: part.text })
        } else {
          const img = parseDataUrl(part.image_url.url)
          if (img) {
            blocks.push({
              type: 'image',
              source: { type: 'base64', media_type: img.mime, data: img.data },
            })
          }
        }
      }
      content = blocks
    }
    contents.push({ role: m.role, content })
  }

  const budget = thinkingBudget(effort)
  const body: Record<string, unknown> = {
    model,
    messages: contents,
    stream: true,
    // thinking 开启时 max_tokens 必须大于 budget
    max_tokens: budget ? budget + 8192 : 8192,
  }
  if (system) body.system = system
  if (budget) body.thinking = { type: 'enabled', budget_tokens: budget }
  return body
}

async function readError(res: Response): Promise<string> {
  let detail = ''
  try {
    const json = await res.json()
    detail = json?.error?.message || ''
  } catch {
    /* ignore */
  }
  detail = (detail || '').slice(0, 300)
  return detail ? `（${detail}）` : ''
}

const HEADERS = {
  'Content-Type': 'application/json',
  'anthropic-version': '2023-06-01',
  'anthropic-dangerous-direct-browser-access': 'true',
}

export const anthropic: LlmAdapter = {
  async streamChat({ baseURL, apiKey, model, messages, thinkingEffort, signal, onChunk }: StreamChatParams) {
    const res = await fetch(apiUrl(baseURL, '/v1/messages'), {
      method: 'POST',
      headers: { ...HEADERS, 'x-api-key': apiKey },
      body: JSON.stringify(toAnthropicBody(messages, model, thinkingEffort)),
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
        return
      }
      const obj = json as {
        type?: string
        delta?: { type?: string; text?: string; thinking?: string }
        error?: { message?: string }
      }
      if (obj?.error) throw new Error(obj.error.message || '服务端在流中返回错误')
      if (obj?.type === 'content_block_delta' && obj.delta) {
        if (obj.delta.type === 'text_delta' && obj.delta.text) {
          full += obj.delta.text
          onChunk(obj.delta.text, 'content')
        } else if (obj.delta.type === 'thinking_delta' && obj.delta.thinking) {
          onChunk(obj.delta.thinking, 'reasoning')
        }
      }
    })
    return full
  },

  async listModels({ baseURL, apiKey }: ListModelsParams) {
    const res = await fetch(apiUrl(baseURL, '/v1/models'), {
      headers: { ...HEADERS, 'x-api-key': apiKey },
    })
    if (!res.ok) {
      throw new Error(`连接失败 ${res.status} ${await readError(res)}`)
    }
    const json = await res.json()
    const list: string[] = (json?.data ?? []).map((m: { id: string }) => m.id)
    return list.sort()
  },
}
