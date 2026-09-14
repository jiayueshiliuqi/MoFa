<script setup lang="ts">
import { ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { needsIosInstallHint } from '@/lib/platform'

/**
 * iOS Safari 引导：提示添加到主屏幕（之后即全屏、有图标、像 App 一样）。
 * 只在 iOS 且未添加到主屏幕时显示，关闭后不再提示。
 */
const KEY = 'mofa.iosHintDismissed'
const visible = ref(needsIosInstallHint && localStorage.getItem(KEY) !== '1')

function dismiss() {
  visible.value = false
  localStorage.setItem(KEY, '1')
}
</script>

<template>
  <Transition name="fade">
    <div v-if="visible" class="ios-hint">
      <Icon name="plus" :size="16" class="ios-hint-icon" />
      <span class="ios-hint-text">
        点底部「分享」→「添加到主屏幕」，即可全屏使用
      </span>
      <button class="ios-hint-close" aria-label="不再提示" @click="dismiss">
        <Icon name="close" :size="15" />
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.ios-hint {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 16px 0;
  padding: 10px 12px;
  border-radius: var(--radius);
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 13px;
  line-height: 1.45;
}

.ios-hint-icon {
  flex-shrink: 0;
}

.ios-hint-text {
  flex: 1;
}

.ios-hint-close {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  opacity: 0.7;
}
</style>
