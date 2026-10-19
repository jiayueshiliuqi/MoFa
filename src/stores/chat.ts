import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import type { Conversation, StoredMessage, SearchInfo, SearchDecisionInfo, MessageFile } from '@/db'
import * as db from '@/db'
import { sleep, uid } from '@/lib/utils'
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
  /** 有部分内容 + 中途出错时的错误说明（正文保留，错误作为附加提示） */
  errorDetail?: string
  /** 联网阶段（仅界面状态，不落库） */
  searchPhase?: 'deciding' | 'searching' | 'done' | 'failed'
  /** 搜索失败原因（仅界面状态） */
  searchError?: string
}

/**
 * IndexedDB 只能存结构化可克隆对象；searchInfo/searchDecision 在 Vue 里是响应式 Proxy，
 * 直接写库会抛 DataCloneError（和附件对象同一类问题），落库前统一拍平。
 */
function plainSearchInfo(info?: SearchInfo): SearchInfo | undefined {
  if (!info) return undefined
  return {
    query: info.query,
    engine: info.engine,
    results: info.results.map((r) => ({ title: r.title, url: r.url })),
  }
}

function plainSearchDecision(info?: SearchDecisionInfo): SearchDecisionInfo | undefined {
  if (!info) return undefined
  return { need: info.need, query: info.query, reasoning: info.reasoning }
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

/** 清洗模型给出的搜索词（去掉解释前缀、引号、句末标点） */
function cleanSearchQuery(q: string): string {
  return q
    .replace(/^(query|搜索词|查询词)\s*[:：]\s*/i, '')
    .replace(/^[\s"'`「『【（(]+|[\s"'`」』】）。.,，!！?？]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}

/**
 * 解析联网决策输出。优先按 JSON 解析；兼容 ```json 围栏、JSON 前后带解释、
 * 以及直接输出 NONE 的情况。无法解析时退回搜索（fallback），保证搜索准确性。
 */
function parseSearchDecision(raw: string, fallback: () => string): string | null {
  const text = raw.trim()
  if (!text) return fallback()

  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
  const candidates = [cleaned]
  const brace = cleaned.match(/\{[\s\S]*\}/)
  if (brace && brace[0] !== cleaned) candidates.push(brace[0])

  for (const c of candidates) {
    try {
      const obj = JSON.parse(c) as { search?: unknown; query?: unknown }
      if (obj.search === false || obj.search === 'false') return null
      if (obj.search === true || obj.search === 'true') {
        const q = cleanSearchQuery(typeof obj.query === 'string' ? obj.query : '')
        return q || fallback()
      }
    } catch {
      /* 试下一个候选 */
    }
  }

  // JSON 轻微损坏（尾逗号、被截断）时的兜底：直接抓字段
  if (/"search"\s*:\s*false/i.test(cleaned)) return null
  const qm = /"query"\s*:\s*"([^"]+)"/i.exec(cleaned)
  if (qm && /"search"\s*:\s*true/i.test(cleaned)) {
    const q = cleanSearchQuery(qm[1])
    if (q) return q
  }

  // 宽松兜底：NONE / 明确说明不需要联网
  if (/^(none|no|false)$/i.test(cleaned) || /不需要联网|无需联网|不用联网/.test(cleaned)) return null
  return fallback()
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
  /** 在途的流式请求（含搜索阶段；openSession/删除会话前等待它落库，避免竞态丢数据） */
  let inflight: Promise<void> | null = null
  /** 同步重入锁：sendMessage/regenerate 的 await 间隙内挡掉重复触发 */
  let busy = false
  /**
   * 「停止」发生在真正建好 AbortController 之前（建会话/写库的 await 间隙）时先记下来，
   * runCompletion 一拿到控制器就立刻中止，避免用户点了停止却还要等整段生成结束。
   */
  let stopRequested = false
  /** 会话切换序号：连续点多个会话时，只让最后一次加载结果生效 */
  let openSeq = 0
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
    // 发送/重生成在进入 runCompletion 之前还有若干 await（建会话、写库），
    // 这些阶段 inflight 仍为 null，必须一并等掉，否则切会话会串数据
    while (busy) await sleep(20)
  }

  function newSession() {
    openSeq++ // 作废在途的 openSession，避免它随后把刚清空的新会话覆盖掉
    void stopAndWait().then(() => {
      activeId.value = null
      messages.value = []
    })
  }

  async function openSession(id: number) {
    const seq = ++openSeq
    await stopAndWait()
    if (seq !== openSeq) return // 等待期间又点了别的会话
    const list = await db.getMessages(id)
    if (seq !== openSeq) return // 读库期间又切走了
    // 会话可能在这段时间被删除（列表里已经没有了），不要打开一个空气泡
    if (!sessions.value.some((s) => s.id === id)) return
    activeId.value = id
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

  /**
   * 发送消息。返回 false 表示未受理（未配置服务商等），调用方可保留草稿；
   * 返回 true 表示已受理（含后续完整的流式过程）。
   */
  async function sendMessage(payload: { text: string; images?: string[]; files?: MessageFile[] }): Promise<boolean> {
    const content = payload.text.trim()
    const images = payload.images ?? []
    // 附件对象来自响应式数组，直接写 IndexedDB 会因 Proxy 无法结构化克隆而失败，
    // 这里复制成普通对象（顺便只保留需要的字段，避免把响应式引用带进持久化层）
    const files: MessageFile[] = (payload.files ?? []).map((f) => ({ name: f.name, text: f.text }))
    // busy 是同步重入锁：isStreaming 在 runCompletion 内才置位，前面的 await 间隙里双击会漏进来
    if ((!content && !images.length && !files.length) || isStreaming.value || busy) return false

    // 未配置服务商时直接拦下，避免凭空创建空会话、丢掉用户输入
    if (!activeConv.value && !useProvidersStore().selectedConfig) {
      toast('请先在设置中添加模型服务', 'warn')
      return false
    }

    stopRequested = false
    busy = true
    try {
      const conv = await ensureConversation()
      const sel = selectionFor(conv)
      if (!sel) {
        toast('请先在设置中添加模型服务', 'warn')
        return false
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
      // 写库期间用户可能已切到别的会话：此时不要把消息塞进当前视图
      if (activeId.value !== conv.id) {
        toast('已切换会话，消息已保存到原会话', 'info')
        return true
      }
      messages.value.push({ ...userMsg, streaming: false, error: false })

      // 首条消息作为会话标题（纯附件消息用文件名）
      if (conv.title === '新对话') {
        conv.title = content.slice(0, 24) || files[0]?.name || '图片对话'
        await db.updateConversation(conv.id!, { title: conv.title })
      }

      await runCompletion(conv, sel.provider, sel.model)
      return true
    } finally {
      busy = false
    }
  }

  async function runCompletion(
    conv: Conversation,
    providerConfig: ProviderConfig,
    model: string,
  ): Promise<void> {
    // 同步置位共享状态：isStreaming 立即生效（挡重入），inflight 覆盖含搜索阶段的全过程
    // （否则切换会话/删除会话的 stopAndWait 会在搜索阶段空转）
    const myController = new AbortController()
    abortController = myController
    isStreaming.value = true
    // 停止键按在建控制器之前：这里立刻消费掉，别让整段生成白跑
    if (stopRequested) {
      stopRequested = false
      myController.abort()
    }

    let flushTimer = 0
    const task = (async () => {
      // 先插入助手占位：判断和搜索阶段也要让用户看到「在工作」，
      // 而不是只有输入框上方一行容易被忽略的状态文字。
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
        searchPhase: webSearchOn.value ? 'deciding' : undefined,
        searchDecision: webSearchOn.value ? { need: false, reasoning: '' } : undefined,
      })

      let acc = ''
      let rAcc = ''
      let searchBlock = ''
      let sentCount = 0
      let droppedCount = 0

      try {
        // 建会话/写库期间用户可能已切到别的会话：不要把占位消息塞进当前视图
        if (activeId.value !== conv.id) return
        messages.value.push(placeholder)

        // —— 联网阶段：判断 → 搜索；进度实时更新到占位消息 ——
        if (webSearchOn.value) {
          const lastUser = [...messages.value].reverse().find((m) => m.role === 'user')
          const question = (lastUser?.content ?? '').trim()
          if (!question) {
            // 纯图片/附件消息没有可搜索文本：不显示判断与搜索
            placeholder.searchDecision = undefined
            placeholder.searchPhase = undefined
          } else {
            const settings = useSettingsStore()
            try {
              searchStatus.value = '正在判断是否需要联网…'
              // 判断过程的 reasoning 实时写入消息：展开「思考中」就能看到进度
              placeholder.searchDecision = await decideSearch(
                question,
                recentContextForSearch(),
                providerConfig,
                model,
                myController.signal,
                (reasoning) => {
                  if (!placeholder.searchDecision) return
                  placeholder.searchDecision = { ...placeholder.searchDecision, reasoning }
                },
              )

              if (placeholder.searchDecision.query) {
                placeholder.searchPhase = 'searching'
                searchStatus.value = `正在搜索：${placeholder.searchDecision.query}`
                try {
                  const outcome = await webSearch(placeholder.searchDecision.query, {
                    engine: settings.searchEngine,
                    maxResults: settings.searchMaxResults,
                    fetchFullText: settings.searchFullText,
                    searxngUrl: settings.searxngUrl,
                    signal: myController.signal,
                  })
                  placeholder.searchInfo = {
                    query: outcome.query,
                    engine: outcome.engine,
                    results: outcome.results.map((r) => ({ title: r.title, url: r.url })),
                  }
                  searchBlock = buildSearchBlock(outcome)
                  placeholder.searchPhase = 'done'
                } catch (e) {
                  if (e instanceof DOMException && e.name === 'AbortError') throw e
                  placeholder.searchPhase = 'failed'
                  placeholder.searchError = e instanceof Error ? e.message.slice(0, 120) : String(e)
                  const reason = e instanceof Error ? e.message.slice(0, 60) : ''
                  toast(`联网搜索失败${reason ? '：' + reason : ''}，本次按模型自身知识回答`, 'warn')
                }
              } else {
                placeholder.searchPhase = 'done'
              }
            } catch (e) {
              // 用户停止：交给外层统一清理；判断失败本身已在 decideSearch 内降级为搜索
              if (e instanceof DOMException && e.name === 'AbortError') throw e
              placeholder.searchPhase = 'failed'
              placeholder.searchError = e instanceof Error ? e.message.slice(0, 120) : String(e)
              const reason = e instanceof Error ? e.message.slice(0, 60) : ''
              toast(`联网判断失败${reason ? '：' + reason : ''}，本次按模型自身知识回答`, 'warn')
            } finally {
              searchStatus.value = null
            }
          }
        }

        // 上下文截断：会话级策略（轮数/tokens）+ 模型窗口兜底
        const policy: ContextPolicy = {
          mode: conv.contextPolicy ?? 'off',
          rounds: conv.contextRounds,
          tokens: conv.contextTokens,
        }
        // 优先用该模型自己从 API 读到的窗口；服务商级值是「取最大」的兜底，
        // 混用 32k/128k 模型时不能拿最大值去截小窗口模型的历史
        const windowTokens =
          providerConfig.modelContexts?.[model] ||
          providerConfig.contextWindow ||
          guessContextWindow(model)
        const systemPrompt = [conv.systemPrompt?.trim(), searchBlock].filter(Boolean).join('\n\n') || undefined
        // 占位消息已在列表里，构造历史时必须排除，否则会多出一条空的 assistant
        const historySource = messages.value.filter((m) => m.id !== placeholder.id)
        const truncation = truncateHistory(
          toLlmHistory(historySource, systemPrompt),
          policy,
          windowTokens,
        )
        const history = truncation.messages
        // 供 UI 展示：本次实际携带的非系统消息数（含刚发出的用户消息）与被丢弃数
        sentCount = history.filter((m) => m.role !== 'system').length
        droppedCount = truncation.dropped || 0
        placeholder.historyCount = sentCount
        placeholder.droppedCount = droppedCount || undefined

        // 流式缓冲：token 攒着再落到响应式状态——既避免逐 token 全量重渲染 markdown，
        // 又保持内容更新的连续性，配合列表的缓动跟随让输出看起来连续。
        // 间隔随内容长度自适应：单次 markdown 重渲染的成本随消息变长线性上涨，
        // 长回复不降频会把主线程打满，表现为输出卡住、滚动掉帧
        let dirty = false
        let rDirty = false
        let lastFlush = 0
        flushTimer = window.setInterval(() => {
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

        // 思考参数只在模型确实支持时下发：很多服务商对未知参数直接 400
        // （例如 OpenAI 官方对 reasoning_effort / enable_thinking），而这时 UI 又隐藏了思考控件，
        // 用户无法把持久化的 high 改回去 —— 会形成「一发就失败」的死锁
        const canThink = useProvidersStore().abilitiesOf(providerConfig.id, model).reasoning
        const effort = canThink ? thinkingEffort.value : 'default'
        acc = await getAdapter(providerConfig.apiStyle).streamChat({
          baseURL: providerConfig.baseURL,
          apiKey: providerConfig.apiKey,
          model,
          messages: history,
          thinkingEffort: effort,
          signal: myController.signal,
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
          droppedCount: droppedCount || undefined,
          searchInfo: plainSearchInfo(placeholder.searchInfo),
          searchDecision: plainSearchDecision(placeholder.searchDecision),
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
              droppedCount: droppedCount || undefined,
              searchInfo: plainSearchInfo(placeholder.searchInfo),
              searchDecision: plainSearchDecision(placeholder.searchDecision),
              createdAt: Date.now(),
            })
            placeholder.id = saved.id!
            await touch(conv)
          } else {
            messages.value = messages.value.filter((m) => m !== placeholder)
          }
        } else {
          // 非主动停止的错误：已生成的内容要保留（长回答最后断网时，用户看到的不能凭空消失）
          if (acc) {
            placeholder.content = acc
            placeholder.reasoning = rAcc || undefined
            placeholder.error = true
            placeholder.errorDetail = e instanceof Error ? e.message : String(e)
            if (!sessions.value.some((s) => s.id === conv.id)) return
            const saved = await db.appendMessage({
              convId: conv.id!,
              role: 'assistant',
              content: acc,
              reasoning: rAcc || undefined,
              model,
              historyCount: sentCount,
              droppedCount: droppedCount || undefined,
              searchInfo: plainSearchInfo(placeholder.searchInfo),
              searchDecision: plainSearchDecision(placeholder.searchDecision),
              createdAt: Date.now(),
            })
            placeholder.id = saved.id!
            await touch(conv)
          } else {
            placeholder.error = true
            placeholder.content = e instanceof Error ? e.message : String(e)
          }
        }
      } finally {
        window.clearInterval(flushTimer)
        searchStatus.value = null
        // 仅当自己仍是当前请求时才复位共享状态：防止「停止后被新请求接管时旧任务清掉新状态」
        if (abortController === myController) {
          isStreaming.value = false
          abortController = null
          inflight = null
        }
      }
    })()
    inflight = task
    await task
  }

  /** 供联网决策参考的最近几轮对话（不含刚发出的这条用户消息） */
  function recentContextForSearch(): string {
    const all = messages.value
    let lastUserIdx = -1
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].role === 'user') {
        lastUserIdx = i
        break
      }
    }
    if (lastUserIdx <= 0) return ''
    return all
      .slice(Math.max(0, lastUserIdx - 4), lastUserIdx)
      .map((m) => {
        const text = (m.content || '（图片或附件）').replace(/\s+/g, ' ').trim().slice(0, 300)
        return `${m.role === 'user' ? '用户' : '助手'}：${text}`
      })
      .join('\n')
  }

  /**
   * 判断最新问题是否需要联网，需要时给出搜索词。
   * 返回 null 表示模型判断「不需要联网」；决策调用失败/输出不可解析时退回用原问题搜索，
   * 避免「开了联网却因为路由器抽风而完全不搜」。
   */
  async function decideSearch(
    userText: string,
    contextText: string,
    provider: ProviderConfig,
    model: string,
    signal: AbortSignal,
    onProgress?: (reasoning: string) => void,
  ): Promise<SearchDecisionInfo> {
    const question = userText.replace(/\s+/g, ' ').trim()
    if (!question) return { need: false } // 纯图片消息没有可搜索的文本
    const fallback = () => question.slice(0, 80)
    // 完全按用户当前的思考设置：开启就正常思考，关闭就不带思考参数。
    // 模型不支持思考时退回 default（不额外下发参数）。
    const canThink = useProvidersStore().abilitiesOf(provider.id, model).reasoning
    const decisionEffort: ThinkingEffort = canThink ? thinkingEffort.value : 'default'
    try {
      const sys = [
        '你是联网搜索决策器。判断回答用户的最新问题是否需要最新的互联网信息。',
        `当前日期：${new Date().toLocaleDateString('zh-CN')}。`,
        '需要联网：实时新闻、天气、股价、赛事、价格、最新版本/发布、政策法规、人物/公司/产品的最新状态，以及用户明确要求搜索、查一下、最新消息。',
        '不需要联网：闲聊、写作、翻译、代码、数学计算、通用知识、创意、对已有上下文的总结或改写。',
        '只输出一行 JSON，不要 markdown 代码块、不要解释：',
        '{"search":true,"query":"适合搜索引擎的查询词"} 或 {"search":false}',
        'query 使用问题的主要语言，保留专有名词和关键报错信息，不超过 30 字；',
        'query 必须能独立表达搜索意图：补全上下文中的指代和省略（上一轮聊北京天气，用户问「那明天呢」，query 应为「北京 明天 天气」）。',
      ].join('\n')
      const userContent =
        (contextText ? `对话上下文：\n${contextText}\n\n` : '') + `用户最新问题：\n${question.slice(0, 600)}`
      let raw = ''
      let reasoning = ''
      await getAdapter(provider.apiStyle).streamChat({
        baseURL: provider.baseURL,
        apiKey: provider.apiKey,
        model,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: userContent },
        ],
        thinkingEffort: decisionEffort,
        signal,
        onChunk: (t, kind) => {
          // 思考内容不参与 JSON 解析，但实时推给「思考中」区块展示
          if (kind === 'reasoning') {
            reasoning += t
            onProgress?.(reasoning)
          } else {
            raw += t
          }
        },
      })
      const parsed = parseSearchDecision(raw, fallback)
      if (parsed) {
        return {
          need: true,
          query: parsed,
          reasoning: (reasoning || `判断需要联网，查询词：${parsed}`).slice(0, 4000),
        }
      }
      return {
        need: false,
        reasoning: (reasoning || '判断无需联网，直接回答。').slice(0, 4000),
      }
    } catch (e) {
      // 用户主动停止要向上传播；其余（网络/模型抽风）退回用原问题搜索
      if (e instanceof DOMException && e.name === 'AbortError') throw e
      return {
        need: true,
        query: fallback(),
        reasoning: '联网判断失败，改用原问题搜索。',
      }
    }
  }

  async function touch(conv: Conversation) {
    if (!sessions.value.some((s) => s.id === conv.id)) return
    conv.updatedAt = Date.now()
    await db.updateConversation(conv.id!, { updatedAt: conv.updatedAt })
    sessions.value.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  function stop() {
    if (abortController) {
      abortController.abort()
      return
    }
    // 还在建会话/写库的 await 间隙里：记下意图，控制器一建好就中止
    if (busy) stopRequested = true
  }

  /**
   * 重新生成指定的助手消息（UI 上"重新生成"传最后一条助手消息；
   * 错误卡上的"重试"传错误消息自身，只移除它，不会误删别的回复）。
   */
  async function regenerate(target?: UiMessage) {
    if (isStreaming.value || busy) return
    const conv = activeConv.value
    if (!conv) return

    const targetMsg =
      target ?? [...messages.value].reverse().find((m) => m.role === 'assistant')
    if (!targetMsg) return

    const idx = messages.value.indexOf(targetMsg)
    if (idx < 0) return

    // 只允许重生成最后一条：否则新回复会追加到末尾，与目标位置之后的对话顺序错乱
    if (idx !== messages.value.length - 1) {
      toast('只能重新生成最后一条回复', 'warn')
      return
    }

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

    stopRequested = false
    busy = true
    try {
      if (targetMsg.id && targetMsg.id > 0) await db.deleteMessage(targetMsg.id)
      // idx 是 await 之前算的，切会话后数组已换，必须重算并确认目标还在
      const nowIdx = messages.value.indexOf(targetMsg)
      if (nowIdx < 0) return
      messages.value.splice(nowIdx, 1)
      await runCompletion(conv, sel.provider, sel.model)
    } finally {
      busy = false
    }
  }

  /** 删除单条消息（流式生成期间不允许删，避免产生没有提问的回复） */
  async function deleteMessage(msg: UiMessage) {
    if (msg.streaming || isStreaming.value) {
      if (isStreaming.value) toast('生成中，暂不能删除消息', 'warn')
      return
    }
    if (msg.id && msg.id > 0) await db.deleteMessage(msg.id)
    messages.value = messages.value.filter((m) => m !== msg)
  }

  /** 编辑用户消息后重发：更新内容、截断其后的消息、重新生成 */
  async function editAndResend(msg: UiMessage, newContent: string) {
    const content = newContent.trim()
    if (!content || isStreaming.value || busy || msg.role !== 'user') return

    const conv = sessions.value.find((s) => s.id === activeId.value)
    if (!conv) return

    const sel = selectionFor(conv)
    if (!sel) {
      toast('请先在设置中添加模型服务', 'warn')
      return
    }

    stopRequested = false
    busy = true
    try {
      msg.content = content
      if (msg.id && msg.id > 0) await db.updateMessage(msg.id, { content })

      // await 之后重新定位（切会话后 messages 数组可能已替换）
      const idx = messages.value.indexOf(msg)
      if (idx < 0) return
      const removed = messages.value.slice(idx + 1)
      for (const m of removed) {
        if (m.id && m.id > 0) await db.deleteMessage(m.id)
      }
      messages.value = messages.value.slice(0, idx + 1)

      await runCompletion(conv, sel.provider, sel.model)
    } finally {
      busy = false
    }
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
