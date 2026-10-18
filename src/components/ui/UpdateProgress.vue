<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { useUpdateProgress } from '@/composables/useUpdateProgress'
import { cancelUpdateDownload } from '@/services/update'

const state = useUpdateProgress()
const canceling = ref(false)

const percent = computed(() =>
  state.phase === 'installing' ? 100 : Math.max(0, Math.min(100, state.percent)),
)

const sizeLabel = computed(() => {
  if (!state.total) return ''
  return `${formatBytes(state.received)} / ${formatBytes(state.total)}`
})

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

watch(
  () => state.visible,
  (v) => {
    if (v) canceling.value = false
  },
)

async function cancel() {
  if (canceling.value) return
  canceling.value = true
  await cancelUpdateDownload()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="state.visible" class="update-backdrop">
        <div class="update-card" role="dialog" aria-live="polite">
          <div class="update-icon"><Icon name="download" :size="22" /></div>
          <div class="update-title">
            {{ state.phase === 'installing' ? '正在打开安装程序…' : `正在下载 v${state.version}` }}
          </div>
          <div class="update-bar">
            <div
              class="update-fill"
              :class="{ installing: state.phase === 'installing' }"
              :style="{ width: `${percent}%` }"
            />
          </div>
          <div class="update-meta">
            <span>{{ percent }}%</span>
            <span>{{ sizeLabel }}</span>
          </div>
          <div class="update-hint">
            {{
              state.phase === 'installing'
                ? '正在调起系统安装器，请稍候…'
                : '下载完成后会弹出系统安装界面，点「安装」即可完成更新'
            }}
          </div>
          <button
            v-if="state.phase === 'downloading'"
            class="update-cancel"
            :disabled="canceling"
            @click="cancel"
          >
            {{ canceling ? '正在取消…' : '取消下载' }}
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.update-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  /* 高于对话框（1300），保证更新进度不会被其他弹层盖住 */
  z-index: 1400;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
}

.update-card {
  width: min(88vw, 340px);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 22px 18px 16px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-lg);
  text-align: center;
}

.update-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin-bottom: 2px;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent);
}

.update-title {
  font-size: 15px;
  font-weight: 600;
}

.update-bar {
  width: 100%;
  height: 6px;
  margin-top: 4px;
  border-radius: 999px;
  background: var(--bg-input);
  overflow: hidden;
}

.update-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--accent);
  transition: width 0.18s ease;
}

.update-fill.installing {
  animation: update-pulse 1s ease-in-out infinite;
}

.update-meta {
  display: flex;
  justify-content: space-between;
  width: 100%;
  font-size: 12px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.update-hint {
  font-size: 12px;
  color: var(--text-tertiary);
  line-height: 1.5;
}

.update-cancel {
  margin-top: 2px;
  padding: 8px 18px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 13px;
}

.update-cancel:disabled {
  opacity: 0.5;
}

@keyframes update-pulse {
  50% {
    opacity: 0.55;
  }
}
</style>
