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

const ROUND_OPTIONS = [5, 10, 20, 30]
const TOKEN_OPTIONS = [8000, 20000, 50000]

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const chat = useChatStore()

const draft = ref('')
// 上下文携带：off=完整历史 / rounds=按轮数 / tokens=按预算
const ctxMode = ref<'off' | 'rounds' | 'tokens'>('off')
const ctxRounds = ref(10)
const ctxTokens = ref(20000)

const { register } = useBackHandler()
let unregisterBack: (() => void) | null = null
watch(
  () => props.open,
  (v) => {
    if (v) {
      const conv = chat.activeConv
      draft.value = conv?.systemPrompt ?? ''
      ctxMode.value = conv?.contextPolicy ?? 'off'
      ctxRounds.value = conv?.contextRounds ?? 10
      const saved = conv?.contextTokens
      ctxTokens.value = typeof saved === 'number' && saved > 0 ? saved : 20000
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

const activePreset = computed(
  () => PRESETS.find((p) => p.prompt === draft.value)?.name ?? null,
)

function applyPreset(p: { name: string; prompt: string }) {
  draft.value = draft.value === p.prompt ? '' : p.prompt
}

/** 自定义 token 加减：步进 1000，下限 1000 */
function adjustTokens(delta: number) {
  const cur = Number(ctxTokens.value)
  const base = Number.isFinite(cur) && cur > 0 ? cur : 20000
  ctxTokens.value = Math.max(1000, Math.round(base + delta))
}

async function save() {
  const hasPrompt = draft.value.trim().length > 0
  const hasContext = ctxMode.value !== 'off'
  // 全新会话且什么都没设置：不保存（避免凭空创建空会话）
  if (!hasPrompt && !hasContext && !chat.activeConv) {
    emit('close')
    return
  }
  await chat.setSystemPrompt(draft.value)
  // v-model.number 对清空的输入会给出 ''：校验兜底，无效值回退默认预算
  const tokensRaw = Number(ctxTokens.value)
  const tokens = Number.isFinite(tokensRaw) && tokensRaw > 0 ? tokensRaw : 20000
  await chat.setContextPolicy({
    mode: ctxMode.value,
    rounds: ctxMode.value === 'rounds' ? ctxRounds.value : undefined,
    tokens: ctxMode.value === 'tokens' ? tokens : undefined,
  })
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
            rows="4"
            placeholder="系统提示词：定义这个对话中 AI 的角色和行为"
          />

          <!-- 上下文携带策略 -->
          <div class="ctx-section">
            <div class="ctx-title">上下文携带</div>
            <div class="segmented">
              <button class="seg-item" :class="{ active: ctxMode === 'off' }" @click="ctxMode = 'off'">
                完整历史
              </button>
              <button class="seg-item" :class="{ active: ctxMode === 'rounds' }" @click="ctxMode = 'rounds'">
                按轮数
              </button>
              <button class="seg-item" :class="{ active: ctxMode === 'tokens' }" @click="ctxMode = 'tokens'">
                按 tokens
              </button>
            </div>

            <div v-if="ctxMode === 'off'" class="ctx-hint">
              携带全部历史（超出模型窗口时自动丢弃最早的消息）
            </div>

            <div v-else-if="ctxMode === 'rounds'" class="ctx-options">
              <div class="ctx-hint">只携带最近 N 轮对话（一轮 = 一问一答）</div>
              <div class="chip-row">
                <button
                  v-for="n in ROUND_OPTIONS"
                  :key="n"
                  class="num-chip"
                  :class="{ active: ctxRounds === n }"
                  @click="ctxRounds = n"
                >
                  {{ n }} 轮
                </button>
              </div>
            </div>

            <div v-else class="ctx-options">
              <div class="ctx-hint">按 token 预算携带最近的消息（估算值，宁多勿少）</div>
              <div class="chip-row">
                <button
                  v-for="n in TOKEN_OPTIONS"
                  :key="n"
                  class="num-chip"
                  :class="{ active: ctxTokens === n }"
                  @click="ctxTokens = n"
                >
                  {{ n >= 1000 ? `${Math.round(n / 1000)}K` : n }}
                </button>
              </div>
              <div class="stepper">
                <button class="step-btn" aria-label="减少" @click="adjustTokens(-1000)">−</button>
                <input
                  v-model.number="ctxTokens"
                  type="number"
                  inputmode="numeric"
                  class="ctx-input"
                  placeholder="自定义"
                />
                <button class="step-btn" aria-label="增加" @click="adjustTokens(1000)">+</button>
              </div>
            </div>
          </div>

          <div class="btn-row">
            <button class="ghost-btn" @click="draft = ''">清空提示词</button>
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
  max-height: 82vh;
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
  min-height: 88px;
  padding: 12px 13px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text);
  outline: none;
  line-height: 1.6;
  font-size: 14px;
}

textarea:focus {
  border-color: var(--accent);
}

/* ---- 上下文策略 ---- */
.ctx-section {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.ctx-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-tertiary);
}

.segmented {
  display: flex;
  padding: 3px;
  background: var(--bg-input);
  border-radius: var(--radius);
}

.seg-item {
  flex: 1;
  padding: 8px 0;
  border-radius: 9px;
  font-size: 13px;
  color: var(--text-secondary);
  transition: all 0.18s ease;
}

.seg-item.active {
  background: var(--bg-elevated);
  color: var(--text);
  font-weight: 550;
  box-shadow: var(--shadow-sm);
}

.ctx-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ctx-hint {
  font-size: 11.5px;
  color: var(--text-tertiary);
  line-height: 1.5;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.num-chip {
  padding: 6px 14px;
  border-radius: 999px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  font-size: 12.5px;
  color: var(--text-secondary);
}

.num-chip.active {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
  font-weight: 550;
}

.ctx-input {
  flex: 1;
  min-width: 0;
  padding: 9px 12px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text);
  outline: none;
  font-size: 13.5px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.ctx-input:focus {
  border-color: var(--accent);
}

/* 自定义加减步进器（替代浏览器原生数字箭头） */
.stepper {
  display: flex;
  align-items: center;
  gap: 8px;
}

.step-btn {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: 19px;
  line-height: 1;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.step-btn:active {
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
  color: var(--accent);
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
