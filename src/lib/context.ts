import type { LlmMessage } from '@/services/llm'
import { estimateHistoryTokens, estimateTokens } from './tokens'

/**
 * 上下文截断：
 * 1) 会话级策略（用户主动收紧）：按轮数 或 按 token 预算，二选一生效
 * 2) 模型窗口兜底（防请求超限）：估算总量超过窗口时从最旧的消息开始丢
 * 系统提示词永远保留；截断永远发生在整条消息的边界。
 */

export type ContextPolicyMode = 'off' | 'rounds' | 'tokens'

export interface ContextPolicy {
  mode: ContextPolicyMode
  rounds?: number
  tokens?: number
}

export interface TruncateResult {
  messages: LlmMessage[]
  /** 被丢弃的消息条数（不含系统提示词） */
  dropped: number
}

export function truncateHistory(
  all: LlmMessage[],
  policy: ContextPolicy,
  windowTokens: number,
): TruncateResult {
  const system = all.filter((m) => m.role === 'system')
  let keep = all.filter((m) => m.role !== 'system')
  let dropped = 0

  // ---- 1) 会话级策略 ----
  if (policy.mode === 'rounds' && policy.rounds && policy.rounds > 0) {
    const max = policy.rounds * 2 // 一轮 = 用户 + 助手各一条
    if (keep.length > max) {
      dropped += keep.length - max
      keep = keep.slice(-max)
    }
  } else if (policy.mode === 'tokens' && policy.tokens && policy.tokens > 0) {
    let used = estimateHistoryTokens(system)
    const kept: LlmMessage[] = []
    for (let i = keep.length - 1; i >= 0; i--) {
      const cost = estimateHistoryTokens([keep[i]])
      if (used + cost > policy.tokens && kept.length > 0) break // 至少保留最近一条
      used += cost
      kept.unshift(keep[i])
    }
    dropped += keep.length - kept.length
    keep = kept
  }

  // ---- 2) 模型窗口兜底（预留输出空间） ----
  // 至少保留最新一条：单条消息本身就超预算时，交由服务端判定，而不是发空历史
  // cap 恒 ≤ 窗口：小窗口服务商（手填 1000 之类）不能因为 2048 下限反而放过超窗历史
  const cap = Math.min(Math.max(2048, windowTokens - 4096), windowTokens)
  while (keep.length > 1 && estimateHistoryTokens(system) + estimateHistoryTokens(keep) > cap) {
    keep = keep.slice(1)
    dropped++
  }

  return { messages: [...system, ...keep], dropped }
}

/** 估算一段纯文本的 token（供 UI 展示用） */
export { estimateTokens }
