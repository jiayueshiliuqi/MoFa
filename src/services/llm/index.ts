import type { LlmAdapter } from './types'
import { openaiCompatible } from './openai-compatible'
import { anthropic } from './anthropic'
import { gemini } from './gemini'
import type { ApiStyle } from '@/stores/providers'

/** 服务商适配器注册表：openai 兼容 / Anthropic 官方 / Gemini 官方 */
const adapters: Record<ApiStyle, LlmAdapter> = {
  openai: openaiCompatible,
  anthropic,
  gemini,
}

export function getAdapter(style: ApiStyle = 'openai'): LlmAdapter {
  return adapters[style] ?? openaiCompatible
}

export type { LlmMessage, StreamChatParams, ListModelsParams, ThinkingEffort } from './types'
