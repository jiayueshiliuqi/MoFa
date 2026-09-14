<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import type { UiMessage } from '@/stores/chat'
import Icon from '@/components/ui/Icon.vue'
import MarkdownView from './MarkdownView.vue'
import { useToast } from '@/composables/useToast'
import { useBackHandler } from '@/composables/useBackHandler'

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

// 图片预览打开时返回键关闭预览
const { register } = useBackHandler()
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
onUnmounted(() => unregisterBack?.())

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

// 流式思考时跟随滚动到最新内容
watch(
  () => props.msg.reasoning,
  async () => {
    if (props.msg.streaming && reasoningOpen.value) {
      await nextTick()
      const el = reasoningBodyEl.value
      if (el) el.scrollTop = el.scrollHeight
    }
  },
)
</script>

<template>
  <div class="msg" :class="isUser ? 'msg-user' : 'msg-assistant'">
    <!-- 用户消息：右侧主题色气泡（或编辑框） -->
    <template v-if="isUser">
      <div v-if="!editing" class="bubble">
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

    <!-- 助手消息：无气泡，直接渲染 markdown（Cherry Studio 风格） -->
    <div v-else class="content">
      <!-- 思考过程 -->
      <div v-if="msg.reasoning" class="reasoning">
        <button class="reasoning-head" @click="reasoningOpen = !reasoningOpen">
          <Icon name="wand" :size="13" />
          <span>{{ msg.streaming ? '思考中…' : '思考过程' }}</span>
          <Icon name="down" :size="14" class="chev" :class="{ open: reasoningOpen }" />
        </button>
        <div v-show="reasoningOpen" ref="reasoningBodyEl" class="reasoning-body">{{ msg.reasoning }}</div>
      </div>

      <div v-if="msg.error" class="error-card">
        <span class="error-text">{{ msg.content }}</span>
        <button class="retry-btn" @click="emit('regenerate', msg)">重试</button>
      </div>
      <MarkdownView v-else :content="msg.content" :streaming="msg.streaming" />
      <div v-if="msg.model && !msg.streaming" class="model-tag">{{ msg.model }}</div>
    </div>

    <!-- 操作行 -->
    <div v-if="!msg.streaming && !editing" class="actions" :class="isUser ? 'actions-user' : ''">
      <button class="action" @click="copyMessage">
        <Icon name="copy" :size="14" />
      </button>
      <button v-if="isUser" class="action" @click="startEdit">
        <Icon name="edit" :size="14" />
      </button>
      <button v-if="!isUser && isLast && !streaming" class="action" @click="emit('regenerate', msg)">
        <Icon name="refresh" :size="14" />
      </button>
      <button class="action" @click="emit('delete')">
        <Icon name="trash" :size="14" />
      </button>
    </div>
  </div>

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
