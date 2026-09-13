import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import type { Conversation, StoredMessage } from '@/db'
import * as db from '@/db'
import { uid } from '@/lib/utils'
import { getAdapter, type LlmMessage, type ThinkingEffort } from '@/services/llm'
import { useProvidersStore } from './providers'
import { useToast } from '@/composables/useToast'

/** 界面层的消息（在持久化字段之上附加流式/错误状态） */
export interface UiMessage extends StoredMessage {
  streaming: boolean
  error: boolean
}

/** 把界面消息转换为 LLM 请求消息（带图的用户消息转为多模态分片） */
function toLlmHistory(list: UiMessage[], systemPrompt?: string): LlmMessage[] {
  const out: LlmMessage[] = []
  if (systemPrompt?.trim()) out.push({ role: 'system', content: systemPrompt.trim() })
  for (const m of list) {
    if (m.error) continue
    if (m.images?.length) {
      out.push({
        role: m.role,
        content: [
          { type: 'text', text: m.content || '（图片）' },
          ...m.images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
        ],
      })
    } else {
      out.push({ role: m.role, content: m.content })
    }
  }
  return out
}

export const useChatStore = defineStore('chat', () => {
  const sessions = ref<Conversation[]>([])
  const activeId = ref<number | null>(null)
  const messages = ref<UiMessage[]>([])
  const isStreaming = ref(false)

  /** 思考强度档位（全局，持久化；对不支持的模型无副作用或由服务商忽略） */
  const thinkingEffort = ref<ThinkingEffort>(loadThinkingEffort())
  function loadThinkingEffort(): ThinkingEffort {
    const v = localStorage.getItem('mofa.thinkingEffort')
    if (v === 'off' || v === 'low' || v === 'medium' || v === 'high' || v === 'default') return v
    // 兼容旧版布尔开关
    return localStorage.getItem('mofa.thinking') === '0' ? 'off' : 'default'
  }
  function setThinkingEffort(v: ThinkingEffort) {
    thinkingEffort.value = v
    localStorage.setItem('mofa.thinkingEffort', v)
  }

  let abortController: AbortController | null = null
  const { show: toast } = useToast()

  const activeConv = computed<Conversation | null>(
    () => sessions.value.find((s) => s.id === activeId.value) ?? null,
  )

  async function init() {
    sessions.value = await db.listConversations()
  }

  function newSession() {
    activeId.value = null
    messages.value = []
  }

  async function openSession(id: number) {
    if (isStreaming.value) stop()
    activeId.value = id
    const list = await db.getMessages(id)
    messages.value = list.map((m) => ({ ...m, streaming: false, error: false }))
  }

  async function deleteSession(id: number) {
    await db.deleteConversation(id)
    sessions.value = sessions.value.filter((s) => s.id !== id)
    if (activeId.value === id) newSession()
  }

  async function ensureConversation(): Promise<Conversation> {
    const existing = sessions.value.find((s) => s.id === activeId.value)
    if (existing) return existing
    const created = await db.createConversation()
    sessions.value.unshift(created)
    activeId.value = created.id!
    // 从响应式数组读回代理再返回，调用方直接修改字段才能触发视图更新
    return sessions.value[0]
  }

  async function sendMessage(payload: { text: string; images?: string[] }) {
    const content = payload.text.trim()
    const images = payload.images ?? []
    if ((!content && !images.length) || isStreaming.value) return

    const providers = useProvidersStore()
    const sel = providers.selectedConfig
    if (!sel) {
      toast('请先在设置中添加模型服务', 'warn')
      return
    }

    const conv = await ensureConversation()
    const userMsg = await db.appendMessage({
      convId: conv.id!,
      role: 'user',
      content,
      images: images.length ? images : undefined,
      createdAt: Date.now(),
    })
    messages.value.push({ ...userMsg, streaming: false, error: false })

    // 首条消息作为会话标题
    if (conv.title === '新对话') {
      conv.title = content.slice(0, 24)
      await db.updateConversation(conv.id!, { title: conv.title })
    }

    await runCompletion(conv, sel.provider, sel.model)
  }

  async function runCompletion(conv: Conversation, providerConfig: { baseURL: string; apiKey: string }, model: string) {
    const history = toLlmHistory(messages.value, conv.systemPrompt)

    // reactive 包装：保证后续直接修改 placeholder 的字段能触发视图更新
    const placeholder = reactive<UiMessage>({
      id: uid(),
      convId: conv.id!,
      role: 'assistant',
      content: '',
      reasoning: '',
      model,
      createdAt: Date.now(),
      streaming: true,
      error: false,
    })
    messages.value.push(placeholder)

    isStreaming.value = true
    abortController = new AbortController()

    // 流式缓冲：token 攒 80ms 再落到响应式状态，避免逐 token 全量重渲染 markdown
    let acc = ''
    let rAcc = ''
    let dirty = false
    let rDirty = false
    const flushTimer = window.setInterval(() => {
      if (placeholder.streaming) {
        if (dirty) {
          placeholder.content = acc
          dirty = false
        }
        if (rDirty) {
          placeholder.reasoning = rAcc
          rDirty = false
        }
      }
    }, 80)

    try {
      acc = await getAdapter('openai').streamChat({
        baseURL: providerConfig.baseURL,
        apiKey: providerConfig.apiKey,
        model,
        messages: history,
        thinkingEffort: thinkingEffort.value,
        signal: abortController.signal,
        onChunk: (t, kind) => {
          if (kind === 'reasoning') {
            rAcc += t
            rDirty = true
          } else {
            acc += t
            dirty = true
          }
        },
      })
      placeholder.content = acc
      placeholder.reasoning = rAcc || undefined
      placeholder.streaming = false
      // 回写持久化后的真实 id，保证后续删除/截断能命中数据库记录
      const saved = await db.appendMessage({
        convId: conv.id!,
        role: 'assistant',
        content: acc,
        reasoning: rAcc || undefined,
        model,
        createdAt: Date.now(),
      })
      placeholder.id = saved.id!
      await touch(conv)
    } catch (e: unknown) {
      placeholder.streaming = false
      if (e instanceof DOMException && e.name === 'AbortError') {
        if (acc) {
          placeholder.content = acc
          placeholder.reasoning = rAcc || undefined
          const saved = await db.appendMessage({
            convId: conv.id!,
            role: 'assistant',
            content: acc,
            reasoning: rAcc || undefined,
            model,
            createdAt: Date.now(),
          })
          placeholder.id = saved.id!
        } else {
          messages.value = messages.value.filter((m) => m !== placeholder)
        }
        await touch(conv)
      } else {
        placeholder.error = true
        placeholder.content = e instanceof Error ? e.message : String(e)
      }
    } finally {
      window.clearInterval(flushTimer)
      isStreaming.value = false
      abortController = null
    }
  }

  async function touch(conv: Conversation) {
    conv.updatedAt = Date.now()
    await db.updateConversation(conv.id!, { updatedAt: conv.updatedAt })
    sessions.value.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  function stop() {
    abortController?.abort()
  }

  /** 重新生成最后一条助手回复 */
  async function regenerate() {
    if (isStreaming.value) return
    const providers = useProvidersStore()
    const sel = providers.selectedConfig
    if (!sel) {
      toast('请先在设置中添加模型服务', 'warn')
      return
    }
    const conv = sessions.value.find((s) => s.id === activeId.value)
    if (!conv) return

    // 移除末尾的助手消息（界面 + 数据库）
    for (let i = messages.value.length - 1; i >= 0; i--) {
      const m = messages.value[i]
      if (m.role === 'assistant') {
        if (m.id && m.id > 0) await db.deleteMessage(m.id)
        messages.value.splice(i, 1)
        break
      }
    }
    if (!messages.value.some((m) => m.role === 'user')) return
    await runCompletion(conv, sel.provider, sel.model)
  }

  /** 删除单条消息（流式中的不可删） */
  async function deleteMessage(msg: UiMessage) {
    if (msg.streaming) return
    if (msg.id && msg.id > 0) await db.deleteMessage(msg.id)
    messages.value = messages.value.filter((m) => m !== msg)
  }

  /** 编辑用户消息后重发：更新内容、截断其后的消息、重新生成 */
  async function editAndResend(msg: UiMessage, newContent: string) {
    const content = newContent.trim()
    if (!content || isStreaming.value || msg.role !== 'user') return

    const providers = useProvidersStore()
    const sel = providers.selectedConfig
    if (!sel) {
      toast('请先在设置中添加模型服务', 'warn')
      return
    }
    const conv = sessions.value.find((s) => s.id === activeId.value)
    if (!conv) return

    msg.content = content
    if (msg.id && msg.id > 0) await db.updateMessage(msg.id, { content })

    const idx = messages.value.indexOf(msg)
    if (idx >= 0) {
      const removed = messages.value.slice(idx + 1)
      for (const m of removed) {
        if (m.id && m.id > 0) await db.deleteMessage(m.id)
      }
      messages.value = messages.value.slice(0, idx + 1)
    }

    await runCompletion(conv, sel.provider, sel.model)
  }

  /** 设置当前会话的系统提示词（没有会话时先创建） */
  async function setSystemPrompt(text: string) {
    const conv = activeConv.value ?? (await ensureConversation())
    conv.systemPrompt = text.trim() || undefined
    await db.updateConversation(conv.id!, { systemPrompt: conv.systemPrompt })
  }

  async function renameSession(id: number, title: string) {
    const t = title.trim()
    if (!t) return
    await db.updateConversation(id, { title: t })
    const s = sessions.value.find((x) => x.id === id)
    if (s) s.title = t
  }

  return {
    sessions,
    activeId,
    activeConv,
    messages,
    isStreaming,
    thinkingEffort,
    setThinkingEffort,
    init,
    newSession,
    openSession,
    deleteSession,
    sendMessage,
    regenerate,
    deleteMessage,
    editAndResend,
    setSystemPrompt,
    renameSession,
    stop,
  }
})
