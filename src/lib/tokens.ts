/**
 * Token 估算（客户端没有分词器，只能估）。
 * 原则：宁可高估（提前截断）也不要低估（请求被模型拒绝）。
 */
import type { LlmMessage } from '@/services/llm'

/** 单张压缩后图片的粗略 token 数（各家的图像计费公式不同，取偏保守的固定值） */
export const IMAGE_TOKENS = 1600

/** 纯文本估算：中日韩字符 1 字 ≈ 1 token，其余 ≈ 4 字符 1 token */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = (text.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/g) ?? []).length
  return Math.ceil(cjk + (text.length - cjk) / 4)
}

/** 一段历史的估算 token 总量（含每条消息的固定开销） */
export function estimateHistoryTokens(messages: LlmMessage[]): number {
  let total = 0
  for (const m of messages) {
    if (typeof m.content === 'string') {
      total += estimateTokens(m.content) + 4
    } else {
      for (const part of m.content) {
        if (part.type === 'text') total += estimateTokens(part.text)
        else total += IMAGE_TOKENS
      }
    }
  }
  return total
}

/** 模型上下文窗口的猜测表（API 不返回时的兜底，服务商设置里可手动覆盖） */
const CONTEXT_HINTS: Array<[RegExp, number]> = [
  // Gemini 1.5 / 2.x 系（flash 与 pro）输入窗口均为 1M
  [/gemini/, 1_000_000],
  [/claude/, 200_000],
  [/gpt-4\.1|gpt-5/, 1_000_000],
  [/gpt-4o|gpt-4-turbo/, 128_000],
  [/\bo[134]\b/, 128_000],
  [/deepseek/, 128_000],
  [/qwen|qwq/, 131_072],
  [/glm-4\.6|glm-5/, 200_000],
  [/glm/, 128_000],
  [/kimi|moonshot/, 128_000],
  [/llama/, 128_000],
  // 旧模型窗口小，宁可按小值提前截断
  [/gpt-4-32k/, 32_768],
  [/gpt-3\.5|gpt-4(?!-|-turbo|o)|text-embedding/, 16_384],
]

export const DEFAULT_CONTEXT_WINDOW = 128_000

export function guessContextWindow(model: string): number {
  const id = model.toLowerCase()
  for (const [re, n] of CONTEXT_HINTS) if (re.test(id)) return n
  return DEFAULT_CONTEXT_WINDOW
}
