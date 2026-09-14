<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from 'vue'
import { useDialog } from '@/composables/useDialog'
import { useBackHandler } from '@/composables/useBackHandler'

const { current, settle } = useDialog()

const draft = ref('')
const inputEl = ref<HTMLInputElement | null>(null)

const { register } = useBackHandler()
let unregisterBack: (() => void) | null = null

watch(
  current,
  async (v) => {
    if (v) {
      draft.value = v.value ?? ''
      // 对话框打开时返回键 = 取消
      unregisterBack?.()
      unregisterBack = register(() => {
        settle(v.kind === 'confirm' ? false : null)
        return true
      })
      await nextTick()
      inputEl.value?.focus()
      inputEl.value?.select()
    } else {
      unregisterBack?.()
      unregisterBack = null
    }
  },
  { immediate: true },
)
onUnmounted(() => unregisterBack?.())

function submit() {
  const c = current.value
  if (!c) return
  if (c.kind === 'prompt') settle(draft.value)
  else settle(true)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="current" class="dialog-backdrop" @click="settle(current.kind === 'confirm' ? false : null)">
        <div class="dialog-card" @click.stop>
          <div class="dialog-title">{{ current.title }}</div>
          <div v-if="current.message" class="dialog-message">{{ current.message }}</div>
          <input
            v-if="current.kind === 'prompt'"
            ref="inputEl"
            v-model="draft"
            type="text"
            :placeholder="current.placeholder"
            @keydown.enter="submit"
          />
          <div class="dialog-btns">
            <button class="dialog-cancel" @click="settle(current.kind === 'confirm' ? false : null)">
              取消
            </button>
            <button
              class="dialog-ok"
              :class="{ danger: current.danger }"
              @click="submit"
            >
              {{ current.confirmText ?? '确定' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
}

.dialog-card {
  width: min(88vw, 340px);
  background: var(--bg-elevated);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
  padding: 20px 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.dialog-title {
  font-size: 15.5px;
  font-weight: 600;
  line-height: 1.5;
}

.dialog-message {
  font-size: 13.5px;
  color: var(--text-secondary);
  line-height: 1.6;
  white-space: pre-wrap;
  max-height: 45vh;
  overflow-y: auto;
}

input {
  width: 100%;
  padding: 11px 13px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text);
  outline: none;
}

input:focus {
  border-color: var(--accent);
}

.dialog-btns {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.dialog-cancel {
  padding: 9px 18px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 14px;
}

.dialog-ok {
  padding: 9px 18px;
  border-radius: var(--radius);
  background: var(--accent);
  color: var(--text-on-accent);
  font-size: 14px;
  font-weight: 550;
}

.dialog-ok:active {
  background: var(--accent-hover);
}

.dialog-ok.danger {
  background: var(--danger);
}
</style>
