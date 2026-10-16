import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import type { Conversation, StoredMessage, SearchInfo, MessageFile } from '@/db'
import * as db from '@/db'
import { uid } from '@/lib/utils'
import { getAdapter, type LlmMessage, type ThinkingEffort } from '@/services/llm'
import { webSearch, buildSearchBlock } from '@/services/websearch'
import { truncateHistory, type ContextPolicy } from '@/lib/context'
import { guessContextWindow } from '@/lib/tokens'
import { useProvidersStore, type ProviderConfig } from './providers'
import { useSettingsStore } from './settings'
import { useToast } from '@/composables/useToast'

/** 界面层的消息（在持久化字段之上附加流式/错误状态） */
export interface UiMessage extends StoredMessage {
  streaming: boolean
  error: boolean
}

/** 附件文件的注入块（随用户消息进入上下文，token 估算与截断自然覆盖） */
function fileBlockOf(m: UiMessage): string {
  if (!m.files?.length) return ''
  return '\n\n' + m.files.map((f) => `【附件文件：${f.name}】\n${f.text}`).join('\n\n')
}

/** 把界面消息转换为 LLM 请求消息（带图的用户消息转为多模态分片，附件文件转为文本注入） */
function toLlmHistory(list: UiMessage[], systemPrompt?: string): LlmMessage[] {
  const out: LlmMessage[] = []
  if (systemPrompt?.trim()) out.push({ role: 'system', content: systemPrompt.trim() })
  for (const m of list) {
    if (m.error) continue
    const fileBlock = fileBlockOf(m)
    if (m.images?.length) {
      out.push({
        role: m.role,
        content: [
          { type: 'text', text: (m.content || '（图片）') + fileBlock },
          ...m.images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
        ],
      })
    } else {
      out.push({ role: m.role, content: m.content + fileBlock })
    }
  }
  return out
}

export const useChatStore = defineStore('chat', () => {
  const sessions = ref<Conversation[]>([])
  const activeId = ref<number | null>(null)
  const messages = ref<UiMessage[]>([])
  const isStreaming = ref(false)

  /** 思考强度档位（全局默认，持久化；对不支持的模型无副作用或由服务商忽略） */
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

  /** 联网搜索开关（全局，发送时用当前设置执行 搜索→注入） */
  const webSearchOn = ref(localStorage.getItem('mofa.webSearch') === '1')
  function toggleWebSearch() {
    webSearchOn.value = !webSearchOn.value
    localStorage.setItem('mofa.webSearch', webSearchOn.value ? '1' : '0')
  }

  /** 联网搜索进行中的状态文案（生成搜索词 / 搜索中），UI 显示在输入栏上方 */
  const searchStatus = ref<string | null>(null)

  let abortController: AbortController | null = null
  /** 在途的流式请求（openSession/删除会话前等待它落库，避免竞态丢数据） */
  let inflight: Promise<void> | null = null
  const { show: toast } = useToast()

  const activeConv = computed<Conversation | null>(
    () => sessions.value.find((s) => s.id === activeId.value) ?? null,
  )

  async function init() {
    sessions.value = await db.listConversations()
  }

  /** 停止在途流式并等待其完全落库 */
  async function stopAndWait() {
    stop()
    if (inflight) await inflight.catch(() => undefined)
  }

  function newSession() {
    void stopAndWait().then(() => {
      activeId.value = null
      messages.value = []
    })
  }

  async function openSession(id: number) {
    await stopAndWait()
    activeId.value = id
    const list = await db.getMessages(id)
    if (activeId.value !== id) return // 等待期间又切走了
    messages.value = list.map((m) => ({ ...m, streaming: false, error: false }))
    // 恢复该会话记忆的模型选择
    restoreSelectionFor(id)
  }

  async function deleteSession(id: number) {
    // 只有关闭正在流式的那个会话才需要停止生成；删别的会话不能连带停掉当前输出
    if (id === activeId.value) await stopAndWait()
    await db.deleteConversation(id)
    sessions.value = sessions.value.filter((s) => s.id !== id)
    if (activeId.value === id) {
      activeId.value = null
      messages.value = []
    }
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

  // ---- 按会话记忆模型 ----

  /** 取当前会话生效的 provider+model：会话有记忆则恢复并同步全局选择，否则用全局选择 */
  function selectionFor(conv: Conversation | null): { provider: ProviderConfig; model: string } | null {
    const providers = useProvidersStore()
    if (conv?.providerId && conv.model) {
      const p = providers.providers.find(
        (x) => x.id === conv.providerId && x.enabled && x.models.includes(conv.model!),
      )
      if (p) {
        providers.selected = { providerId: p.id, model: conv.model }
        return { provider: p, model: conv.model }
      }
    }
    return providers.selectedConfig
  }

  /** 把当前全局模型选择写入会话（打开会话恢复选择 / 手动换模型 / 发送时调用） */
  async function syncSelectionToConv(conv: Conversation) {
    const providers = useProvidersStore()
    const sel = providers.selectedConfig
    if (!sel) return
    if (conv.providerId === sel.provider.id && conv.model === sel.model) return
    conv.providerId = sel.provider.id
    conv.model = sel.model
    await db.updateConversation(conv.id!, { providerId: conv.providerId, model: conv.model })
  }

  function restoreSelectionFor(id: number) {
    const conv = sessions.value.find((s) => s.id === id)
    if (conv) selectionFor(conv)
  }

  async function sendMessage(payload: { text: string; images?: string[]; files?: MessageFile[] }) {
    const content = payload.text.trim()
    const images = payload.images ?? []
    const files = payload.files ?? []
    if ((!content && !images.length && !files.length) || isStreaming.value) return

    // 未配置服务商时直接拦下，避免凭空创建空会话、丢掉用户输入
    if (!activeConv.value && !useProvidersStore().selectedConfig) {
      toast('请先在设置中添加模型服务', 'warn')
      return
    }

    const conv = await ensureConversation()
    const sel = selectionFor(conv)
    if (!sel) {
      toast('请先在设置中添加模型服务', 'warn')
      return
    }
    await syncSelectionToConv(conv)

    const userMsg = await db.appendMessage({
      convId: conv.id!,
      role: 'user',
      content,
      images: images.length ? images : undefined,
      files: files.length ? files : undefined,
      createdAt: Date.now(),
    })
    messages.value.push({ ...userMsg, streaming: false, error: false })

    // 首条消息作为会话标题
    if (conv.title === '新对话') {
      conv.title = content.slice(0, 24) || '图片对话'
      await db.updateConversation(conv.id!, { title: conv.title })
    }

    await runCompletion(conv, sel.provider, sel.model)
  }

  async function runCompletion(conv: Conversation, providerConfig: { baseURL: string; apiKey: string; apiStyle: ProviderConfig['apiStyle']; contextWindow?: number }, model: string) {
    abortController = new AbortController()
    isStreaming.value = true

    // —— 联网搜索阶段（可选）：模型生成搜索词 → 引擎降级搜索 → 组装来源块 ——
    let searchInfo: SearchInfo | undefined
    let searchBlock = ''
    if (webSearchOn.value) {
      try {
        const settings = useSettingsStore()
        const lastUser = [...messages.value].reverse().find((m) => m.role === 'user')
        searchStatus.value = '正在生成搜索词…'
        const query = await makeSearchQuery(lastUser?.content ?? '', providerConfig, model)
        searchStatus.value = `正在搜索：${query}`
        const outcome = await webSearch(query, {
          engine: settings.searchEngine,
          maxResults: settings.searchMaxResults,
          fetchFullText: settings.searchFullText,
          searxngUrl: settings.searxngUrl,
          signal: abortController!.signal,
        })
        searchInfo = {
          query: outcome.query,
          engine: outcome.engine,
          results: outcome.results.map((r) => ({ title: r.title, url: r.url })),
        }
        searchBlock = buildSearchBlock(outcome)
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          searchStatus.value = null
          isStreaming.value = false
          abortController = null
          return
        }
        // 所有引擎都失败时不用联网结果，改按模型自身知识回答
        const reason = e instanceof Error ? e.message.slice(0, 60) : ''
        toast(`联网搜索失败${reason ? '：' + reason : ''}，本次按模型自身知识回答`, 'warn')
      }
      searchStatus.value = null
    }

    // 上下文截断：会话级策略（轮数/tokens）+ 模型窗口兜底
    const policy: ContextPolicy = {
      mode: conv.contextPolicy ?? 'off',
      rounds: conv.contextRounds,
      tokens: conv.contextTokens,
    }
    const windowTokens = providerConfig.contextWindow || guessContextWindow(model)
    const systemPrompt = [conv.systemPrompt?.trim(), searchBlock].filter(Boolean).join('\n\n') || undefined
    const truncation = truncateHistory(
      toLlmHistory(messages.value, systemPrompt),
      policy,
      windowTokens,
    )
    const history = truncation.messages
    // 供 UI 展示：本次实际携带的非系统消息数（含刚发出的用户消息）与被丢弃数
    const sentCount = history.filter((m) => m.role !== 'system').length

    // reactive 包装：保证后续直接修改 placeholder 的字段能触发视图更新
    const placeholder = reactive<UiMessage>({
      id: uid(),
      convId: conv.id!,
      role: 'assistant',
      content: '',
      reasoning: '',
      model,
      historyCount: sentCount,
      droppedCount: truncation.dropped || undefined,
      searchInfo,
      createdAt: Date.now(),
      streaming: true,
      error: false,
    })
    messages.value.push(placeholder)

    // 流式缓冲：token 攒着再落到响应式状态——既避免逐 token 全量重渲染 markdown，
    // 又保持内容更新的连续性，配合列表的缓动跟随让输出看起来连续。
    // 间隔随内容长度自适应：单次 markdown 重渲染的成本随消息变长线性上涨，
    // 长回复不降频会把主线程打满，表现为输出卡住、滚动掉帧
    let acc = ''
    let rAcc = ''
    let dirty = false
    let rDirty = false
    let lastFlush = 0
    const flushTimer = window.setInterval(() => {
      if (!placeholder.streaming) return
      const size = acc.length + rAcc.length
      const minGap = size > 16000 ? 400 : size > 8000 ? 200 : size > 3000 ? 100 : 40
      if (Date.now() - lastFlush < minGap) return
      lastFlush = Date.now()
      if (dirty) {
        placeholder.content = acc
        dirty = false
      }
      if (rDirty) {
        placeholder.reasoning = rAcc
        rDirty = false
      }
    }, 40)

    const task = (async () => {
      try {
        acc = await getAdapter(providerConfig.apiStyle).streamChat({
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
        // 会话已被删除则丢弃结果（避免孤儿数据）
        if (!sessions.value.some((s) => s.id === conv.id)) return
        // 回写持久化后的真实 id，保证后续删除/截断能命中数据库记录
        const saved = await db.appendMessage({
          convId: conv.id!,
          role: 'assistant',
          content: acc,
          reasoning: rAcc || undefined,
          model,
          historyCount: sentCount,
          droppedCount: truncation.dropped || undefined,
          searchInfo,
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
            if (!sessions.value.some((s) => s.id === conv.id)) return
            const saved = await db.appendMessage({
              convId: conv.id!,
              role: 'assistant',
              content: acc,
              reasoning: rAcc || undefined,
              model,
              historyCount: sentCount,
              droppedCount: truncation.dropped || undefined,
              searchInfo,
              createdAt: Date.now(),
            })
            placeholder.id = saved.id!
            await touch(conv)
          } else {
            messages.value = messages.value.filter((m) => m !== placeholder)
          }
        } else {
          placeholder.error = true
          placeholder.content = e instanceof Error ? e.message : String(e)
        }
      } finally {
        window.clearInterval(flushTimer)
        isStreaming.value = false
        abortController = null
        inflight = null
      }
    })()
    inflight = task
    await task
  }

  /** 让模型把用户问题改写成搜索引擎查询词；模型输出无效或调用失败时退回原始问题文本 */
  async function makeSearchQuery(
    userText: string,
    provider: { baseURL: string; apiKey: string; apiStyle: ProviderConfig['apiStyle'] },
    model: string,
  ): Promise<string> {
    const fallback = () => userText.replace(/\s+/g, ' ').trim().slice(0, 80)
    try {
      const sys =
        '你是搜索查询生成器。根据用户的最新问题输出 1 个适合搜索引擎的查询词：' +
        '只输出查询词本身，不要任何解释、引号或句末标点；使用问题的主要语言；' +
        '保留专有名词和关键报错信息；长度控制在 30 字以内。'
      let q = ''
      await getAdapter(provider.apiStyle).streamChat({
        baseURL: provider.baseURL,
        apiKey: provider.apiKey,
        model,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: userText.slice(0, 600) },
        ],
        thinkingEffort: 'off',
        signal: abortController!.signal,
        onChunk: (t) => {
          q += t
        },
      })
      q = q.replace(/^[\s"'「『【（(]+|[\s"'」』】）。.,，!！?？]+$/g, '').trim()
      return q.length >= 2 && q.length <= 100 ? q : fallback()
    } catch (e) {
      // 用户主动停止要向上传播；其余（网络/模型抽风）退回原始问题继续搜索
      if (e instanceof DOMException && e.name === 'AbortError') throw e
      return fallback()
    }
  }

  async function touch(conv: Conversation) {
    if (!sessions.value.some((s) => s.id === conv.id)) return
    conv.updatedAt = Date.now()
    await db.updateConversation(conv.id!, { updatedAt: conv.updatedAt })
    sessions.value.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  function stop() {
    abortController?.abort()
  }

  /**
   * 重新生成指定的助手消息（UI 上"重新生成"传最后一条助手消息；
   * 错误卡上的"重试"传错误消息自身，只移除它，不会误删别的回复）。
   */
  async function regenerate(target?: UiMessage) {
    if (isStreaming.value) return
    const conv = activeConv.value
    if (!conv) return

    const targetMsg =
      target ?? [...messages.value].reverse().find((m) => m.role === 'assistant')
    if (!targetMsg) return

    const idx = messages.value.indexOf(targetMsg)
    if (idx < 0) return

    // 先确认前面有用户消息（否则无从生成），再做删除
    if (!messages.value.slice(0, idx).some((m) => m.role === 'user')) {
      toast('前面没有可生成的用户消息', 'warn')
      return
    }

    const sel = selectionFor(conv)
    if (!sel) {
      toast('请先在设置中添加模型服务', 'warn')
      return
    }

    if (targetMsg.id && targetMsg.id > 0) await db.deleteMessage(targetMsg.id)
    messages.value.splice(idx, 1)

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

    const conv = sessions.value.find((s) => s.id === activeId.value)
    if (!conv) return

    const sel = selectionFor(conv)
    if (!sel) {
      toast('请先在设置中添加模型服务', 'warn')
      return
    }

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

  /** 设置当前会话的系统提示词（没有会话且内容为空时直接忽略，不凭空建会话） */
  async function setSystemPrompt(text: string) {
    const t = text.trim()
    if (!t && !activeConv.value) return
    const conv = activeConv.value ?? (await ensureConversation())
    conv.systemPrompt = t || undefined
    await db.updateConversation(conv.id!, { systemPrompt: conv.systemPrompt })
  }

  /** 设置当前会话的上下文携带策略（三选一：完整 / 按轮数 / 按 tokens） */
  async function setContextPolicy(policy: {
    mode: 'off' | 'rounds' | 'tokens'
    rounds?: number
    tokens?: number
  }) {
    const isDefault = policy.mode === 'off'
    if (isDefault && !activeConv.value) return // 全新会话且默认值：不建会话
    const conv = activeConv.value ?? (await ensureConversation())
    // 无效值兜底（清空/0/负数），避免策略静默失效
    const rounds = Number(policy.rounds)
    const tokens = Number(policy.tokens)
    conv.contextPolicy = policy.mode === 'off' ? undefined : policy.mode
    conv.contextRounds =
      policy.mode === 'rounds' && Number.isFinite(rounds) && rounds > 0 ? rounds : undefined
    conv.contextTokens =
      policy.mode === 'tokens' && Number.isFinite(tokens) && tokens > 0 ? tokens : undefined
    await db.updateConversation(conv.id!, {
      contextPolicy: conv.contextPolicy,
      contextRounds: conv.contextRounds,
      contextTokens: conv.contextTokens,
    })
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
    webSearchOn,
    toggleWebSearch,
    searchStatus,
    init,
    newSession,
    openSession,
    deleteSession,
    sendMessage,
    regenerate,
    deleteMessage,
    editAndResend,
    setSystemPrompt,
    setContextPolicy,
    syncSelectionToConv,
    renameSession,
    stop,
  }
})
