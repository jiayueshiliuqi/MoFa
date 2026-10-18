import type { LlmMessage } from '@/services/llm'
import { estimateHistoryTokens, estimateTokens } from './tokens'

/**
 * 上下文截断：
 * 1) 会话级策略（用户主动收紧）：按轮数 或 按 token 预算，二选一生效
 * 2) 模型窗口兜底（防请求超限）：估算总量超过窗口时从最旧的消息开始丢
 * 系统提示词永远保留；截断永远发生在整条消息的边界。
 *
 * 关键约束：截断后必须以 user 消息开头。按条数/按 token 从尾部切很容易留下
 * assistant 开头的历史，Anthropic 会直接 400（first message must use "user" role），
 * Gemini 也要求 user/model 交替。因此在所有裁剪之后再统一做一次角色规整。
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

/** 丢弃开头的 assistant 消息、合并相邻同角色消息，保证首条是 user 且角色交替 */
export function normalizeRoles(list: LlmMessage[]): LlmMessage[] {
  const out: LlmMessage[] = []
  for (const m of list) {
    const prev = out[out.length - 1]
    if (!prev) {
      // 历史必须以 user 开头；孤立的 assistant 直接丢弃
      if (m.role === 'user') out.push(m)
      continue
    }
    if (prev.role === m.role) {
      // 相邻同角色合并成一条（Anthropic/Gemini 不接受连续同角色）
      out[out.length - 1] = {
        role: prev.role,
        content: joinContent(prev.content, m.content),
      }
    } else {
      out.push(m)
    }
  }
  // 以 assistant 结尾是正常的（等待模型续写），但首条必须是 user
  return out
}

function joinContent(
  a: LlmMessage['content'],
  b: LlmMessage['content'],
): LlmMessage['content'] {
  const toParts = (c: LlmMessage['content']) =>
    typeof c === 'string' ? [{ type: 'text' as const, text: c }] : c
  return [...toParts(a), ...toParts(b)]
}

export function truncateHistory(
  all: LlmMessage[],
  policy: ContextPolicy,
  windowTokens: number,
): TruncateResult {
  const system = all.filter((m) => m.role === 'system')
  let keep = all.filter((m) => m.role !== 'system')
  const before = keep.length

  // ---- 1) 会话级策略 ----
  if (policy.mode === 'rounds' && policy.rounds && policy.rounds > 0) {
    // 从末尾往前找第 N 个 user，从该处开始保留（不按条数切，避免切出 assistant 开头）
    let seen = 0
    let start = 0
    for (let i = keep.length - 1; i >= 0; i--) {
      if (keep[i].role === 'user') {
        seen++
        if (seen >= policy.rounds) {
          start = i
          break
        }
      }
    }
    keep = keep.slice(start)
  } else if (policy.mode === 'tokens' && policy.tokens && policy.tokens > 0) {
    let used = estimateHistoryTokens(system)
    const kept: LlmMessage[] = []
    for (let i = keep.length - 1; i >= 0; i--) {
      const cost = estimateHistoryTokens([keep[i]])
      if (used + cost > policy.tokens && kept.length > 0) break // 至少保留最近一条
      used += cost
      kept.unshift(keep[i])
    }
    keep = kept
  }

  // ---- 2) 模型窗口兜底（预留输出空间） ----
  // 至少保留最新一条：单条消息本身就超预算时，交由服务端判定，而不是发空历史
  // cap 恒 ≤ 窗口：小窗口服务商（手填 1000 之类）不能因为 2048 下限反而放过超窗历史
  const cap = Math.min(Math.max(2048, windowTokens - 4096), windowTokens)
  while (keep.length > 1 && estimateHistoryTokens(system) + estimateHistoryTokens(keep) > cap) {
    keep = keep.slice(1)
  }

  // ---- 3) 角色规整：丢弃 assistant 开头、合并同角色 ----
  const normalized = normalizeRoles(keep)
  const dropped = Math.max(0, before - normalized.length)
  return { messages: [...system, ...normalized], dropped }
}

/** 估算一段纯文本的 token（供 UI 展示用） */
export { estimateTokens }
