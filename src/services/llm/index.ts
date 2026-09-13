import type { LlmAdapter } from './types'
import { openaiCompatible } from './openai-compatible'

export type ApiStyle = 'openai'

/** 服务商适配器注册表。以后新增 anthropic / gemini 原生协议时在这里登记 */
const adapters: Record<ApiStyle, LlmAdapter> = {
  openai: openaiCompatible,
}

export function getAdapter(style: ApiStyle = 'openai'): LlmAdapter {
  return adapters[style]
}

export type { LlmMessage, StreamChatParams, ListModelsParams, ThinkingEffort } from './types'
