<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import type { UiMessage } from '@/stores/chat'
import Icon from '@/components/ui/Icon.vue'
import MarkdownView from './MarkdownView.vue'
import { useToast } from '@/composables/useToast'
import { useBackHandler } from '@/composables/useBackHandler'
import { docName, mdToDocxFile, mdToPlain, saveTextFile, shareOrDownload } from '@/lib/filesave'
import { isNative, openExternal } from '@/lib/platform'

const props = defineProps<{
  msg: UiMessage
  isLast: boolean
  streaming: boolean
}>()

const emit = defineEmits<{
  regenerate: [msg: UiMessage]
  delete: []
  edit: [content: string]
}>()

const { show } = useToast()

// 用户消息的编辑态
const editing = ref(false)
const draft = ref('')
const editEl = ref<HTMLTextAreaElement | null>(null)

// 联网搜索来源面板（默认收起）
const searchOpen = ref(false)

/** 来源链接：原生端交给系统浏览器（WebView 不处理 _blank）；网页端保留默认新标签行为 */
function onSourceClick(e: MouseEvent, url: string) {
  if (!/^https?:\/\//.test(url)) {
    e.preventDefault()
    return
  }
  if (isNative) {
    e.preventDefault()
    openExternal(url)
  }
}

async function startEdit() {
  editing.value = true
  draft.value = props.msg.content
  await nextTick()
  editEl.value?.focus()
}

function submitEdit() {
  if (!draft.value.trim()) return
  editing.value = false
  emit('edit', draft.value)
}

async function copyMessage() {
  try {
    await navigator.clipboard.writeText(props.msg.content)
    show('已复制', 'success')
  } catch {
    show('复制失败', 'error')
  }
}

/** 全屏预览图片 */
const previewing = ref(false)
const previewSrc = ref('')
function previewImage(src: string) {
  previewSrc.value = src
  previewing.value = true
}

// ---- 存为文件（txt / md / json / docx）----
const saveSheetOpen = ref(false)
const isJsonContent = computed(() => {
  const t = props.msg.content.trim()
  if (!(t.startsWith('{') || t.startsWith('['))) return false
  try {
    JSON.parse(t)
    return true
  } catch {
    return false
  }
})

async function saveAs(fmt: 'md' | 'txt' | 'json' | 'docx') {
  saveSheetOpen.value = false
  const base = props.msg.model ?? 'MoFa'
  try {
    let file
    if (fmt === 'docx') {
      file = await mdToDocxFile(props.msg.content, docName(base, 'docx'))
    } else if (fmt === 'txt') {
      file = saveTextFile(mdToPlain(props.msg.content), docName(base, 'txt'))
    } else if (fmt === 'json') {
      file = saveTextFile(props.msg.content, docName(base, 'json'), 'application/json')
    } else {
      file = saveTextFile(props.msg.content, docName(base, 'md'), 'text/markdown')
    }
    const how = await shareOrDownload(file)
    if (how !== 'cancelled') show(how === 'shared' ? '已打开系统分享，可选择保存位置' : '已开始下载', 'success')
  } catch {
    show('保存失败', 'error')
  }
}

// 返回键处理（图片预览 / 存文件面板共用注册器；声明必须在 watch 之前）
const { register } = useBackHandler()

// 存文件面板打开时返回键关闭
let unregisterSaveBack: (() => void) | null = null
watch(
  saveSheetOpen,
  (v) => {
    if (v) {
      unregisterSaveBack = register(() => {
        saveSheetOpen.value = false
        return true
      })
    } else {
      unregisterSaveBack?.()
      unregisterSaveBack = null
    }
  },
)

// 图片预览打开时返回键关闭预览
let unregisterBack: (() => void) | null = null
watch(
  previewing,
  (v) => {
    if (v) {
      unregisterBack = register(() => {
        previewing.value = false
        return true
      })
    } else {
      unregisterBack?.()
      unregisterBack = null
    }
  },
)
// 编辑态：安卓返回键应先取消编辑，而不是直接退出应用
let unregisterEditBack: (() => void) | null = null
watch(
  editing,
  (v) => {
    if (v) {
      unregisterEditBack = register(() => {
        editing.value = false
        return true
      })
    } else {
      unregisterEditBack?.()
      unregisterEditBack = null
    }
  },
)
onUnmounted(() => {
  unregisterBack?.()
  unregisterSaveBack?.()
  unregisterEditBack?.()
  stopReasonFollow()
})

const isUser = computed(() => props.msg.role === 'user')

// 思考过程面板：流式期间自动展开，结束后自动收起（仍可手动点开）
const reasoningOpen = ref(false)
const reasoningBodyEl = ref<HTMLElement | null>(null)
watch(
  () => props.msg.streaming,
  (s) => {
    reasoningOpen.value = !!s
  },
  // immediate：消息挂载时可能已在流式中
  { immediate: true },
)

// 流式思考时缓动跟随滚动到最新内容（每帧插值，避免一跳一跳）
// 用户手动翻阅时完全让位，滚回底部自动恢复
let reasonRaf = 0
const reasonPaused = ref(false)
function stopReasonFollow() {
  if (reasonRaf) {
    cancelAnimationFrame(reasonRaf)
    reasonRaf = 0
  }
}
function pauseReasonFollow() {
  reasonPaused.value = true
  stopReasonFollow()
}
function onReasonScroll() {
  const el = reasoningBodyEl.value
  if (reasonPaused.value && el && el.scrollHeight - el.scrollTop - el.clientHeight < 40) {
    reasonPaused.value = false
  }
}
function reasonFrame() {
  const el = reasoningBodyEl.value
  if (!el || !props.msg.streaming || !reasoningOpen.value) {
    reasonRaf = 0
    return
  }
  const dist = el.scrollHeight - el.scrollTop - el.clientHeight
  if (dist > 1) el.scrollTop += dist * 0.25
  reasonRaf = requestAnimationFrame(reasonFrame)
}
function startReasonFollow() {
  if (!reasonRaf) reasonRaf = requestAnimationFrame(reasonFrame)
}
watch(
  () => props.msg.reasoning,
  () => {
    if (props.msg.streaming && reasoningOpen.value && !reasonPaused.value) startReasonFollow()
  },
)
watch([() => props.msg.streaming, reasoningOpen], ([s, open]) => {
  if (s && open && !reasonPaused.value) startReasonFollow()
  else stopReasonFollow()
  if (!s) reasonPaused.value = false
})
</script>

<template>
  <div class="msg" :class="isUser ? 'msg-user' : 'msg-assistant'">
    <!-- 用户消息：右侧主题色气泡（或编辑框） -->
    <template v-if="isUser">
      <div v-if="!editing" class="bubble">
        <div v-if="msg.files?.length" class="bubble-files">
          <div v-for="(f, i) in msg.files" :key="i" class="bubble-file">
            <Icon name="file" :size="12" />
            <span class="bubble-file-name">{{ f.name }}</span>
          </div>
        </div>
        <div v-if="msg.images?.length" class="bubble-images">
          <img v-for="(img, i) in msg.images" :key="i" :src="img" alt="" @click="previewImage(img)" />
        </div>
        <span v-if="msg.content">{{ msg.content }}</span>
      </div>
      <div v-else class="edit-box">
        <textarea ref="editEl" v-model="draft" rows="3" />
        <div class="edit-btns">
          <button class="edit-cancel" @click="editing = false">取消</button>
          <button class="edit-save" @click="submitEdit">保存并重发</button>
        </div>
      </div>
    </template>

    <!-- 助手消息：无气泡，直接渲染 markdown -->
    <div v-else class="content">
      <!-- 思考过程 -->
      <div v-if="msg.reasoning" class="reasoning">
        <button class="reasoning-head" @click="reasoningOpen = !reasoningOpen">
          <Icon name="wand" :size="13" />
          <span>{{ msg.streaming ? '思考中…' : '思考过程' }}</span>
          <Icon name="down" :size="14" class="chev" :class="{ open: reasoningOpen }" />
        </button>
        <div
          v-show="reasoningOpen"
          ref="reasoningBodyEl"
          class="reasoning-body"
          @touchmove.passive="pauseReasonFollow"
          @wheel.passive="pauseReasonFollow"
          @scroll="onReasonScroll"
        >{{ msg.reasoning }}</div>
      </div>

      <div v-if="msg.error && !msg.content" class="error-card">
        <span class="error-text">{{ msg.content }}</span>
        <button v-if="isLast" class="retry-btn" @click="emit('regenerate', msg)">重试</button>
      </div>
      <template v-else>
        <!-- 联网搜索来源 -->
        <div v-if="msg.searchInfo?.results.length" class="search-info">
          <button class="search-head" @click="searchOpen = !searchOpen">
            <Icon name="globe" :size="13" />
            <span class="search-head-text">
              已搜索「{{ msg.searchInfo.query }}」 · {{ msg.searchInfo.results.length }} 条来源
            </span>
            <Icon name="down" :size="14" class="chev" :class="{ open: searchOpen }" />
          </button>
          <div v-show="searchOpen" class="search-sources">
            <a
              v-for="(r, i) in msg.searchInfo.results"
              :key="i"
              class="search-source"
              :href="r.url"
              target="_blank"
              rel="noopener noreferrer"
              @click="onSourceClick($event, r.url)"
            >
              <span class="search-source-idx">[{{ i + 1 }}]</span>
              <span class="search-source-title">{{ r.title }}</span>
            </a>
          </div>
        </div>
        <MarkdownView :content="msg.content" :streaming="msg.streaming" />
        <!-- 部分内容 + 中途出错：正文照常显示，错误单独提示并保留重试 -->
        <div v-if="msg.error && msg.errorDetail" class="error-card error-inline">
          <span class="error-text">生成中断：{{ msg.errorDetail }}</span>
          <button v-if="isLast" class="retry-btn" @click="emit('regenerate', msg)">重试</button>
        </div>
      </template>
      <div v-if="(msg.model || msg.historyCount) && !msg.streaming" class="model-tag">
        <template v-if="msg.model">{{ msg.model }}</template>
        <template v-if="msg.historyCount">
          <template v-if="msg.model"> · </template>
          <span class="ctx-info">
            携带 {{ msg.historyCount }} 条上下文{{ msg.droppedCount ? `（更早 ${msg.droppedCount} 条未携带）` : '' }}
          </span>
        </template>
      </div>
    </div>

    <!-- 操作行 -->
    <div v-if="!msg.streaming && !editing" class="actions" :class="isUser ? 'actions-user' : ''">
      <button class="action" @click="copyMessage">
        <Icon name="copy" :size="14" />
      </button>
      <button
        v-if="!isUser && !msg.error"
        class="action"
        aria-label="存为文件"
        @click="saveSheetOpen = true"
      >
        <Icon name="file" :size="14" />
      </button>
      <button v-if="isUser && !streaming" class="action" @click="startEdit">
        <Icon name="edit" :size="14" />
      </button>
      <button v-if="!isUser && isLast && !streaming" class="action" @click="emit('regenerate', msg)">
        <Icon name="refresh" :size="14" />
      </button>
      <!-- 生成过程中禁止删除，避免出现「没有提问的回复」 -->
      <button class="action" :disabled="streaming" @click="emit('delete')">
        <Icon name="trash" :size="14" />
      </button>
    </div>
  </div>

  <!-- 存为文件：格式选择 -->
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="saveSheetOpen" class="save-sheet-backdrop" @click="saveSheetOpen = false">
        <div class="save-sheet" @click.stop>
          <div class="save-sheet-title">存为文件</div>
          <button class="save-sheet-item" @click="saveAs('md')">
            <Icon name="file" :size="15" /> Markdown（.md）
          </button>
          <button v-if="isJsonContent" class="save-sheet-item" @click="saveAs('json')">
            <Icon name="file" :size="15" /> JSON（.json）
          </button>
          <button class="save-sheet-item" @click="saveAs('txt')">
            <Icon name="file" :size="15" /> 纯文本（.txt）
          </button>
          <button class="save-sheet-item" @click="saveAs('docx')">
            <Icon name="file" :size="15" /> Word 文档（.docx）
          </button>
          <button class="save-sheet-item save-sheet-cancel" @click="saveSheetOpen = false">取消</button>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- 图片全屏预览 -->
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="previewing" class="image-viewer" @click="previewing = false">
        <img :src="previewSrc" alt="" />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.msg {
  display: flex;
  flex-direction: column;
  max-width: 100%;
  padding: 4px 0;
}

.msg-user {
  align-items: flex-end;
}

.msg-assistant {
  align-items: stretch;
}

.bubble {
  max-width: 86%;
  padding: 10px 14px;
  border-radius: var(--radius-lg);
  border-bottom-right-radius: 6px;
  background: var(--accent);
  color: var(--text-on-accent);
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
}

.bubble-files {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 6px;
  justify-content: flex-end;
}

.bubble-file {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.18);
  color: inherit;
  font-size: 11.5px;
}

.bubble-file-name {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bubble-images {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}

.bubble-images:empty {
  margin-bottom: 0;
}

.bubble-images img {
  width: 120px;
  height: 120px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  border: 1px solid rgba(255, 255, 255, 0.35);
  display: block;
}

/* 存为文件面板 */
.save-sheet-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.save-sheet {
  width: 100%;
  max-width: 420px;
  padding: 10px 14px calc(14px + var(--safe-bottom, 0px));
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  background: var(--bg-elevated);
}

.save-sheet-title {
  padding: 4px 4px 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-tertiary);
}

.save-sheet-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 13px 8px;
  border-radius: var(--radius);
  font-size: 14.5px;
  color: var(--text);
  text-align: left;
}

.save-sheet-item:active {
  background: var(--bg-input);
}

.save-sheet-cancel {
  color: var(--text-tertiary);
  justify-content: center;
  border-top: 1px solid var(--border);
  border-radius: 0;
  margin-top: 4px;
}

.image-viewer {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.88);
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.image-viewer img {
  max-width: 100%;
  max-height: 100%;
  border-radius: var(--radius);
}

.content {
  min-width: 0;
  width: 100%;
}

.error-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: var(--radius);
  background: var(--accent-soft);
  border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
}

.edit-box {
  width: min(86%, 480px);
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  border: 1px solid var(--border);
}

.edit-box textarea {
  width: 100%;
  resize: vertical;
  min-height: 70px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--text);
  outline: none;
  font-size: 15px;
  line-height: 1.5;
}

.edit-box textarea:focus {
  border-color: var(--accent);
}

.edit-btns {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.edit-cancel {
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 13px;
}

.edit-save {
  padding: 6px 14px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--text-on-accent);
  font-size: 13px;
  font-weight: 550;
}

.error-text {
  font-size: 13.5px;
  color: var(--danger);
  word-break: break-all;
}

.retry-btn {
  align-self: flex-start;
  padding: 5px 14px;
  border-radius: 999px;
  font-size: 13px;
  color: var(--danger);
  border: 1px solid color-mix(in srgb, var(--danger) 40%, transparent);
}

.model-tag {
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: 'JetBrains Mono', Menlo, Consolas, monospace;
}

/* 思考过程面板 */
.reasoning {
  margin: 2px 0 8px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-input);
  overflow: hidden;
}

/* 联网搜索来源面板：与思考面板同款容器，紧凑版 */
.search-info {
  margin: 2px 0 8px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-input);
  overflow: hidden;
}

.search-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 10px;
  color: var(--text-secondary);
  font-size: 12px;
  text-align: left;
}

.search-head-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chev {
  flex-shrink: 0;
  transition: transform 0.18s ease;
}

.chev.open {
  transform: rotate(180deg);
}

.search-sources {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px 10px 8px;
  border-top: 1px solid var(--border);
}

.search-source {
  display: flex;
  gap: 4px;
  padding: 5px 0;
  font-size: 12.5px;
  color: var(--text-secondary);
  text-decoration: none;
  line-height: 1.45;
}

.search-source-idx {
  flex-shrink: 0;
  color: var(--accent);
}

.search-source-title {
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.reasoning-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 12px;
  font-size: 12px;
  color: var(--text-tertiary);
}

.reasoning-head .chev {
  margin-left: auto;
  transition: transform 0.2s ease;
}

.reasoning-head .chev.open {
  transform: rotate(180deg);
}

.reasoning-body {
  padding: 4px 12px 10px;
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow-y: auto;
  border-top: 1px dashed var(--border);
  padding-top: 8px;
}

.actions {
  display: flex;
  gap: 2px;
  margin-top: 3px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.actions-user {
  justify-content: flex-end;
}

/* 移动端没有 hover，常显但弱化；桌面 hover 显示 */
@media (hover: hover) {
  .msg:hover .actions {
    opacity: 1;
  }
}

@media (hover: none) {
  .actions {
    opacity: 0.55;
  }
}

.action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  color: var(--text-tertiary);
}

.action:active {
  background: var(--bg-active);
  color: var(--text-secondary);
}
</style>
