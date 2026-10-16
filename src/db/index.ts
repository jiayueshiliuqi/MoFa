import Dexie, { type Table } from 'dexie'

/** 会话（本地持久化，IndexedDB / Dexie） */
export interface Conversation {
  id?: number
  title: string
  /** 对话级系统提示词（助手设定） */
  systemPrompt?: string
  /** 会话记忆的模型选择（按会话分模型） */
  providerId?: string
  model?: string
  /** 上下文携带策略：off=完整历史（仍有模型窗口兜底）；rounds/tokens 二选一 */
  contextPolicy?: 'off' | 'rounds' | 'tokens'
  contextRounds?: number
  contextTokens?: number
  createdAt: number
  updatedAt: number
}

/** 助手消息附带的联网搜索信息（来源列表供 UI 展示） */
export interface SearchInfo {
  query: string
  engine: string
  results: Array<{ title: string; url: string }>
}

/** 用户消息附带的文件（已提取为纯文本，随消息持久化） */
export interface MessageFile {
  name: string
  text: string
}

export interface StoredMessage {
  id?: number
  convId: number
  role: 'user' | 'assistant'
  content: string
  /** 用户消息附带的图片（压缩后的 data URL） */
  images?: string[]
  /** 用户消息附带的文件（已提取为文本） */
  files?: MessageFile[]
  /** 助手消息的思考过程（reasoning_content） */
  reasoning?: string
  model?: string
  /** 本次回复实际携带的历史条数（含当次用户消息）；截断丢弃的条数 */
  historyCount?: number
  droppedCount?: number
  /** 本条回复生成时的联网搜索信息 */
  searchInfo?: SearchInfo
  createdAt: number
}

class MoFaDB extends Dexie {
  conversations!: Table<Conversation, number>
  messages!: Table<StoredMessage, number>

  constructor() {
    super('mofa')
    this.version(1).stores({
      conversations: '++id, updatedAt',
      messages: '++id, convId',
    })
  }
}

export const db = new MoFaDB()

export async function listConversations(): Promise<Conversation[]> {
  return db.conversations.orderBy('updatedAt').reverse().toArray()
}

export async function createConversation(title = '新对话'): Promise<Conversation> {
  const now = Date.now()
  const id = await db.conversations.add({ title, createdAt: now, updatedAt: now })
  return { id, title, createdAt: now, updatedAt: now }
}

export async function updateConversation(id: number, patch: Partial<Conversation>): Promise<void> {
  await db.conversations.update(id, patch)
}

export async function deleteConversation(id: number): Promise<void> {
  await db.transaction('rw', db.conversations, db.messages, async () => {
    await db.conversations.delete(id)
    await db.messages.where('convId').equals(id).delete()
  })
}

export async function getMessages(convId: number): Promise<StoredMessage[]> {
  return db.messages.where('convId').equals(convId).sortBy('id')
}

export async function appendMessage(msg: StoredMessage): Promise<StoredMessage> {
  const id = await db.messages.add(msg)
  return { ...msg, id }
}

export async function updateMessage(id: number, patch: Partial<StoredMessage>): Promise<void> {
  await db.messages.update(id, patch)
}

export async function deleteMessage(id: number): Promise<void> {
  await db.messages.delete(id)
}
