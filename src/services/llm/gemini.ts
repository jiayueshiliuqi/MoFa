import type { ListModelsParams, LlmAdapter, StreamChatParams } from './types'
import type { LlmMessage, ThinkingEffort } from './types'
import { readSseStream } from './sse'
import { parseDataUrl } from './anthropic'
import { compactSecret } from '@/lib/sanitize'

/**
 * Google Gemini 原生协议适配器（streamGenerateContent）。
 * - 认证：URL 参数 key=（官方 API 支持 CORS，浏览器/WebView 可直连）
 * - SSE data 行为完整 JSON：candidates[0].content.parts[]，
 *   part.thought === true 的是思考内容，其余为正文
 */

function baseUrl(base: string): string {
  return base.trim().replace(/\/+$/, '').replace(/\/v1beta$/, '')
}

/** 思考强度 → Gemini thinkingBudget（0=关闭，省略=动态） */
function thinkingBudget(effort: ThinkingEffort | undefined): number | null {
  if (effort === 'off') return 0
  if (effort === 'low') return 1024
  if (effort === 'medium') return 4096
  if (effort === 'high') return 8192
  return null
}

function toGeminiBody(
  messages: LlmMessage[],
  effort: ThinkingEffort | undefined,
): Record<string, unknown> {
  let system: string | undefined
  const contents: Array<{ role: 'user' | 'model'; parts: Array<Record<string, unknown>> }> = []

  for (const m of messages) {
    if (m.role === 'system') {
      if (typeof m.content === 'string') system = m.content
      continue
    }
    const parts: Array<Record<string, unknown>> = []
    if (typeof m.content === 'string') {
      parts.push({ text: m.content })
    } else {
      for (const part of m.content) {
        if (part.type === 'text') {
          parts.push({ text: part.text })
        } else {
          const img = parseDataUrl(part.image_url.url)
          if (img) parts.push({ inlineData: { mimeType: img.mime, data: img.data } })
        }
      }
    }
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts })
  }

  const body: Record<string, unknown> = { contents }
  if (system) body.systemInstruction = { parts: [{ text: system }] }
  const budget = thinkingBudget(effort)
  if (budget !== null) {
    body.generationConfig = { thinkingConfig: { thinkingBudget: budget } }
  }
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

export const gemini: LlmAdapter = {
  async streamChat(params: StreamChatParams) {
    // 防御性清理：零宽字符会导致请求 URL / key 非法
    const baseURL = compactSecret(params.baseURL)
    const apiKey = compactSecret(params.apiKey)
    const model = compactSecret(params.model)
    const { messages, thinkingEffort, signal, onChunk } = params

    const url = `${baseUrl(baseURL)}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toGeminiBody(messages, thinkingEffort)),
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
        error?: { message?: string }
        candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>
      }
      if (obj?.error) throw new Error(obj.error.message || '服务端在流中返回错误')
      const parts = obj?.candidates?.[0]?.content?.parts
      if (!parts) return
      for (const p of parts) {
        if (typeof p.text !== 'string' || !p.text) continue
        if (p.thought) onChunk(p.text, 'reasoning')
        else {
          full += p.text
          onChunk(p.text, 'content')
        }
      }
    })
    return full
  },

  async listModels(params: ListModelsParams) {
    const baseURL = compactSecret(params.baseURL)
    const apiKey = compactSecret(params.apiKey)
    const res = await fetch(`${baseUrl(baseURL)}/v1beta/models?pageSize=200&key=${encodeURIComponent(apiKey)}`)
    if (!res.ok) {
      throw new Error(`连接失败 ${res.status} ${await readError(res)}`)
    }
    const json = await res.json()
    const list = (json?.models ?? []) as Array<{ name?: string; inputTokenLimit?: number }>
    return list
      .map((m) => ({
        id: (m.name ?? '').replace(/^models\//, ''),
        // Gemini 是少数在模型列表里返回真实上下文窗口的服务商
        contextWindow: m.inputTokenLimit ?? undefined,
      }))
      .filter((m) => m.id)
      .sort((a, b) => a.id.localeCompare(b.id))
  },
}
