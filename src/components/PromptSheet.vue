<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useBackHandler } from '@/composables/useBackHandler'

/** 内置助手预设 */
const PRESETS: Array<{ name: string; prompt: string }> = [
  {
    name: '通用助手',
    prompt: '你是一个乐于助人的 AI 助手，回答简洁、准确、结构清晰。',
  },
  {
    name: '翻译专家',
    prompt:
      '你是一名专业翻译。将用户输入的内容在中文和英文之间互译：输入是中文则译为英文，输入是英文则译为中文。只输出译文，不要解释。',
  },
  {
    name: '代码专家',
    prompt:
      '你是一名资深软件工程师。回答编程问题时给出可直接运行的代码，标注所用语言，并简要说明关键点。',
  },
  {
    name: '写作助手',
    prompt: '你是一名中文写作助手，擅长润色、扩写和缩写。保持用户的原意与语气，输出规范的中文。',
  },
  {
    name: '苏格拉底导师',
    prompt:
      '你是苏格拉底式导师。不直接给出答案，而是通过一系列引导性问题帮助用户自己推理出结论，每次最多问一个问题。',
  },
]

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const chat = useChatStore()

const draft = ref('')

// 打开时用当前会话的提示词初始化（已并入上方 open watch）

const activePreset = computed(
  () => PRESETS.find((p) => p.prompt === draft.value)?.name ?? null,
)

const { register } = useBackHandler()
let unregisterBack: (() => void) | null = null
watch(
  () => props.open,
  (v) => {
    if (v) draft.value = chat.activeConv?.systemPrompt ?? ''
    if (v) {
      unregisterBack = register(() => {
        emit('close')
        return true
      })
    } else {
      unregisterBack?.()
      unregisterBack = null
    }
  },
)
onUnmounted(() => unregisterBack?.())

function applyPreset(p: { name: string; prompt: string }) {
  draft.value = draft.value === p.prompt ? '' : p.prompt
}

async function save() {
  await chat.setSystemPrompt(draft.value)
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="backdrop" @click="emit('close')" />
    </Transition>
    <Transition name="slide-up">
      <div v-if="open" class="sheet">
        <div class="sheet-bar" />
        <div class="sheet-head">
          <div class="sheet-title">对话设定</div>
          <div v-if="activePreset" class="active-preset">{{ activePreset }}</div>
        </div>

        <div class="sheet-body">
          <div class="preset-row">
            <button
              v-for="p in PRESETS"
              :key="p.name"
              class="preset-chip"
              :class="{ active: activePreset === p.name }"
              @click="applyPreset(p)"
            >
              {{ p.name }}
            </button>
          </div>

          <textarea
            v-model="draft"
            rows="5"
            placeholder="系统提示词：定义这个对话中 AI 的角色和行为（相当于 Cherry Studio 的助手设定）"
          />

          <div class="btn-row">
            <button class="ghost-btn" @click="draft = ''">清空</button>
            <button class="primary-btn" @click="save">保存</button>
          </div>
          <div class="safe-bottom-pad" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 900;
}

.sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  max-height: 78vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-elevated);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  box-shadow: var(--shadow-lg);
  z-index: 901;
}

.sheet-bar {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: var(--border-strong);
  margin: 10px auto 4px;
}

.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 18px 0;
}

.sheet-title {
  font-size: 15.5px;
  font-weight: 650;
}

.active-preset {
  font-size: 12px;
  color: var(--accent);
  background: var(--accent-soft);
  padding: 3px 10px;
  border-radius: 999px;
}

.sheet-body {
  overflow-y: auto;
  padding: 12px 16px 4px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.safe-bottom-pad {
  height: calc(10px + var(--safe-bottom));
}

.preset-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.preset-chip {
  padding: 7px 14px;
  border-radius: 999px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  font-size: 13px;
  color: var(--text-secondary);
  transition: all 0.15s ease;
}

.preset-chip.active {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
}

textarea {
  width: 100%;
  resize: vertical;
  min-height: 110px;
  padding: 12px 13px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text);
  outline: none;
  line-height: 1.6;
}

textarea:focus {
  border-color: var(--accent);
}

.btn-row {
  display: flex;
  gap: 10px;
}

.primary-btn {
  flex: 1;
  padding: 12px;
  border-radius: var(--radius);
  background: var(--accent);
  color: var(--text-on-accent);
  font-size: 14.5px;
  font-weight: 600;
}

.primary-btn:active {
  background: var(--accent-hover);
}

.ghost-btn {
  padding: 12px 22px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 14.5px;
}
</style>
