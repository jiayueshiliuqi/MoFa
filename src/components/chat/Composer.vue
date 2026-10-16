<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { useProvidersStore } from '@/stores/providers'
import { useChatStore } from '@/stores/chat'
import type { ThinkingEffort } from '@/services/llm'
import type { MessageFile } from '@/db'
import { fileToCompressedDataUrl } from '@/lib/image'
import { extractFileText, MAX_MESSAGE_FILE_CHARS } from '@/lib/filetext'
import { useToast } from '@/composables/useToast'
import { useBackHandler } from '@/composables/useBackHandler'

const emit = defineEmits<{
  send: [payload: { text: string; images?: string[]; files?: MessageFile[] }]
  stop: []
  pickModel: []
}>()

const providers = useProvidersStore()
const chat = useChatStore()
const text = ref('')
const images = ref<string[]>([])
const files = ref<MessageFile[]>([])
const textareaEl = ref<HTMLTextAreaElement | null>(null)
const fileEl = ref<HTMLInputElement | null>(null)
const docEl = ref<HTMLInputElement | null>(null)
const thinkMenuOpen = ref(false)
const attachMenuOpen = ref(false)
const { show } = useToast()

const props = defineProps<{ streaming: boolean }>()

const MAX_IMAGES = 4

const EFFORT_OPTIONS: Array<{ value: ThinkingEffort; label: string; hint: string }> = [
  { value: 'default', label: '默认', hint: '模型自带行为' },
  { value: 'off', label: '关闭', hint: '不思考，最快' },
  { value: 'low', label: '低', hint: '轻量思考' },
  { value: 'medium', label: '中', hint: '均衡' },
  { value: 'high', label: '高', hint: '深度思考' },
]

const canSend = computed(
  () => (text.value.trim().length > 0 || images.value.length > 0 || files.value.length > 0) && !props.streaming,
)

const modelLabel = computed(() => providers.selectedConfig?.model ?? '')

/** 当前模型是否支持思考（决定是否显示思考强度选择） */
const thinkAvailable = computed(() => {
  const sel = providers.selectedConfig
  return sel ? providers.abilitiesOf(sel.provider.id, sel.model).reasoning : false
})

const effortLabel = computed(
  () => EFFORT_OPTIONS.find((o) => o.value === chat.thinkingEffort)?.label ?? '默认',
)

function pickEffort(v: ThinkingEffort) {
  chat.setThinkingEffort(v)
  thinkMenuOpen.value = false
}

// 思考强度菜单 / 附件菜单打开时返回键关闭
const { register } = useBackHandler()
let unregisterBack: (() => void) | null = null
watch(
  thinkMenuOpen,
  (v) => {
    if (v) {
      unregisterBack = register(() => {
        thinkMenuOpen.value = false
        return true
      })
    } else {
      unregisterBack?.()
      unregisterBack = null
    }
  },
)
let unregisterAttachBack: (() => void) | null = null
watch(
  attachMenuOpen,
  (v) => {
    if (v) {
      unregisterAttachBack = register(() => {
        attachMenuOpen.value = false
        return true
      })
    } else {
      unregisterAttachBack?.()
      unregisterAttachBack = null
    }
  },
)
onUnmounted(() => {
  unregisterBack?.()
  unregisterAttachBack?.()
})

async function autoGrow() {
  await nextTick()
  const el = textareaEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 150)}px`
}

async function pickImages(e: Event) {
  const input = e.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = '' // 允许重复选择同一张
  attachMenuOpen.value = false
  const room = MAX_IMAGES - images.value.length
  if (files.length > room) show(`一次最多带 ${MAX_IMAGES} 张图`, 'warn')
  for (const f of files.slice(0, room)) {
    try {
      images.value.push(await fileToCompressedDataUrl(f))
    } catch {
      show('图片处理失败', 'error')
    }
  }
}

function removeImage(i: number) {
  images.value.splice(i, 1)
}

/** 选择文件：逐个在本地提取文本（PDF/Word/文本类），超预算拒绝 */
async function pickDocs(e: Event) {
  const input = e.target as HTMLInputElement
  const picked = [...(input.files ?? [])]
  input.value = ''
  attachMenuOpen.value = false
  for (const f of picked) {
    const used = files.value.reduce((sum, x) => sum + x.text.length, 0)
    if (used >= MAX_MESSAGE_FILE_CHARS) {
      show(`附件总量已达上限（约 ${Math.round(MAX_MESSAGE_FILE_CHARS / 1000)}k 字）`, 'warn')
      break
    }
    try {
      const text = await extractFileText(f)
      if (used + text.length > MAX_MESSAGE_FILE_CHARS) {
        show(`「${f.name}」放不下了：附件总量已达上限`, 'warn')
        continue
      }
      files.value.push({ name: f.name, text })
    } catch (err) {
      show(`${f.name}：${err instanceof Error ? err.message : '读取失败'}`, 'error')
    }
  }
}

function removeFile(i: number) {
  files.value.splice(i, 1)
}

function submit() {
  if (!canSend.value) return
  emit('send', {
    text: text.value.trim(),
    images: images.value.length ? [...images.value] : undefined,
    files: files.value.length ? [...files.value] : undefined,
  })
  text.value = ''
  images.value = []
  files.value = []
  autoGrow()
}

function onKeydown(e: KeyboardEvent) {
  // 输入法合成期间（拼音选字）的 Enter 不发送
  if (e.isComposing || e.keyCode === 229) return
  // 仅桌面（精确指针设备）用 Enter 发送，移动端回车换行、用发送按钮
  const finePointer = window.matchMedia('(pointer: fine)').matches
  if (e.key === 'Enter' && !e.shiftKey && finePointer) {
    e.preventDefault()
    submit()
  }
}
</script>

<template>
  <div class="composer-wrap">
    <div class="composer">
      <div class="chip-row">
        <button v-if="modelLabel" class="model-chip" @click="emit('pickModel')">
          <span class="model-chip-text">{{ modelLabel }}</span>
          <Icon name="down" :size="14" />
        </button>
        <button v-else class="model-chip model-chip-empty" @click="emit('pickModel')">
          选择模型
        </button>
        <div v-if="thinkAvailable" class="think-wrap">
          <div v-if="thinkMenuOpen" class="think-backdrop" @click="thinkMenuOpen = false" />
          <button
            class="model-chip think-chip"
            :class="{ off: chat.thinkingEffort === 'off' }"
            @click="thinkMenuOpen = !thinkMenuOpen"
          >
            思考·{{ effortLabel }}
            <Icon name="down" :size="13" />
          </button>
          <Transition name="fade">
            <div v-if="thinkMenuOpen" class="think-menu">
              <div class="think-menu-title">思考强度</div>
              <button
                v-for="opt in EFFORT_OPTIONS"
                :key="opt.value"
                class="think-option"
                :class="{ active: chat.thinkingEffort === opt.value }"
                @click="pickEffort(opt.value)"
              >
                <span class="think-option-label">{{ opt.label }}</span>
                <span class="think-option-hint">{{ opt.hint }}</span>
                <Icon v-if="chat.thinkingEffort === opt.value" name="check" :size="15" class="think-check" />
              </button>
            </div>
          </Transition>
        </div>
        <button
          class="model-chip web-chip"
          :class="{ active: chat.webSearchOn }"
          :aria-label="chat.webSearchOn ? '关闭联网搜索' : '开启联网搜索'"
          @click="chat.toggleWebSearch()"
        >
          <Icon name="globe" :size="13" />
          联网
        </button>
      </div>

      <div v-if="images.length" class="image-previews">
        <div v-for="(img, i) in images" :key="i" class="image-preview">
          <img :src="img" alt="" />
          <button class="image-remove" aria-label="移除图片" @click="removeImage(i)">
            <Icon name="close" :size="12" />
          </button>
        </div>
      </div>

      <div v-if="files.length" class="file-chips">
        <div v-for="(f, i) in files" :key="i" class="file-chip" :title="f.text.slice(0, 200)">
          <Icon name="file" :size="12" class="file-chip-icon" />
          <span class="file-chip-name">{{ f.name }}</span>
          <button class="file-chip-remove" aria-label="移除文件" @click="removeFile(i)">
            <Icon name="close" :size="11" />
          </button>
        </div>
      </div>

      <div class="input-row">
        <div class="attach-wrap">
          <div v-if="attachMenuOpen" class="think-backdrop" @click="attachMenuOpen = false" />
          <button
            class="icon-btn attach-btn"
            :class="{ open: attachMenuOpen }"
            aria-label="添加附件"
            @click="attachMenuOpen = !attachMenuOpen"
          >
            <Icon name="clip" :size="20" />
          </button>
          <Transition name="fade">
            <div v-if="attachMenuOpen" class="think-menu attach-menu">
              <button class="think-option attach-option" @click="fileEl?.click()">
                <Icon name="eye" :size="15" />
                <span class="think-option-label">图片</span>
                <span class="think-option-hint">发给视觉模型</span>
              </button>
              <button class="think-option attach-option" @click="docEl?.click()">
                <Icon name="file" :size="15" />
                <span class="think-option-label">文件</span>
                <span class="think-option-hint">PDF / Word / 文本，提取文字后发送</span>
              </button>
            </div>
          </Transition>
        </div>
        <input ref="fileEl" type="file" accept="image/*" multiple hidden @change="pickImages" />
        <input ref="docEl" type="file" multiple hidden @change="pickDocs" />
        <textarea
          ref="textareaEl"
          v-model="text"
          rows="1"
          placeholder="发消息…"
          @input="autoGrow"
          @keydown="onKeydown"
        />
        <button
          v-if="streaming"
          class="send-btn stop"
          aria-label="停止生成"
          @click="emit('stop')"
        >
          <Icon name="stop" :size="18" />
        </button>
        <button
          v-else
          class="send-btn"
          :class="{ disabled: !canSend }"
          :disabled="!canSend"
          aria-label="发送"
          @click="submit"
        >
          <Icon name="send" :size="18" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.composer-wrap {
  flex-shrink: 0;
  padding: 8px 12px calc(10px + var(--safe-bottom));
  background: linear-gradient(to top, var(--bg) 65%, transparent);
}

.composer {
  max-width: var(--composer-max-w);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 9px 10px 10px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-md);
}

.chip-row {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
}

.model-chip {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 12.5px;
  font-weight: 500;
}

.model-chip-empty {
  background: var(--bg-input);
  color: var(--text-secondary);
}

.think-chip {
  flex-shrink: 0;
}

.think-chip.off {
  background: var(--bg-input);
  color: var(--text-tertiary);
  text-decoration: line-through;
}

/* 附件菜单与文件 chips */
.attach-wrap {
  position: relative;
  flex-shrink: 0;
}

.attach-menu {
  left: 0;
  bottom: calc(100% + 10px);
  width: max-content;
  max-width: 300px;
  min-width: 250px;
}

.attach-option .think-option-label {
  white-space: nowrap;
}

.attach-option .think-option-hint {
  white-space: nowrap;
}

.attach-option {
  width: 100%;
}

.attach-btn.open {
  color: var(--accent);
}

.file-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}

.file-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 5px 8px;
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  border: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-secondary);
}

.file-chip-icon {
  flex-shrink: 0;
  color: var(--accent);
}

.file-chip-name {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-chip-remove {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  color: var(--text-tertiary);
}

/* 联网开关：开启时主题色，关闭时灰色（不用删除线，避免和思考·关闭语义混淆） */
.web-chip {
  flex-shrink: 0;
  background: var(--bg-input);
  color: var(--text-tertiary);
}

.web-chip.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.think-wrap {
  position: relative;
  flex-shrink: 0;
}

.think-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
}

.think-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  min-width: 190px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: 6px;
  z-index: 50;
}

.think-menu-title {
  padding: 6px 12px 4px;
  font-size: 11.5px;
  color: var(--text-tertiary);
  font-weight: 600;
}

.think-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  padding: 9px 12px;
  border-radius: var(--radius);
}

.think-option:active {
  background: var(--bg-hover);
}

.think-option.active {
  color: var(--accent);
}

.think-option-label {
  font-size: 14px;
  font-weight: 550;
}

.think-option-hint {
  font-size: 11.5px;
  color: var(--text-tertiary);
}

.think-check {
  margin-left: auto;
}

.model-chip-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-previews {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.image-preview {
  position: relative;
  flex-shrink: 0;
  width: 64px;
  height: 64px;
  border-radius: var(--radius);
  overflow: hidden;
  border: 1px solid var(--border);
}

.image-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.image-remove {
  position: absolute;
  top: 3px;
  right: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
}

.input-row {
  display: flex;
  align-items: flex-end;
  gap: 4px;
}

.attach-btn {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  margin-bottom: 2px;
}

textarea {
  flex: 1;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  line-height: 1.5;
  max-height: 150px;
  padding: 6px 4px;
}

textarea::placeholder {
  color: var(--text-tertiary);
}

.send-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--text-on-accent);
  transition: background-color 0.15s ease, opacity 0.15s ease;
}

.send-btn:active {
  background: var(--accent-hover);
}

.send-btn.disabled {
  opacity: 0.35;
}

.send-btn.stop {
  background: var(--bg-input);
  color: var(--text);
  border: 1px solid var(--border);
}
</style>
