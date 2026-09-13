/** LLM 接入层的统一抽象。UI 层只依赖这些类型，不关心各服务商协议差异。 */

export interface TextPart {
  type: 'text'
  text: string
}

export interface ImagePart {
  type: 'image_url'
  image_url: { url: string }
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  /** 纯文本用 string；带图片的多模态消息用分片数组（OpenAI 兼容格式） */
  content: string | Array<TextPart | ImagePart>
}

/** 思考强度档位：default=不传参跟随模型默认；off/low/medium/high 映射到请求参数 */
export type ThinkingEffort = 'default' | 'off' | 'low' | 'medium' | 'high'

export interface StreamChatParams {
  baseURL: string
  apiKey: string
  model: string
  messages: LlmMessage[]
  /** 思考强度（off → enable_thinking:false；low/medium/high → reasoning_effort） */
  thinkingEffort?: ThinkingEffort
  signal?: AbortSignal
  /** kind 区分正文与思考过程（DeepSeek/Qwen 系的 reasoning_content 字段） */
  onChunk: (text: string, kind: 'content' | 'reasoning') => void
}

export interface ListModelsParams {
  baseURL: string
  apiKey: string
}

/** 所有服务商适配器实现同一接口（当前只有 OpenAI 兼容，后续加 anthropic 等） */
export interface LlmAdapter {
  streamChat(params: StreamChatParams): Promise<string>
  listModels(params: ListModelsParams): Promise<string[]>
}
