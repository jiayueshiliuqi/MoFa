<script setup lang="ts">
import { useToast } from '@/composables/useToast'

const { toasts } = useToast()
</script>

<template>
  <div class="toast-host">
    <TransitionGroup name="toast">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type">{{ t.text }}</div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  top: calc(var(--safe-top) + 60px);
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  z-index: 1000;
  pointer-events: none;
}

.toast {
  max-width: 78vw;
  padding: 9px 18px;
  border-radius: 999px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-md);
  font-size: 13.5px;
  color: var(--text);
}

.toast.error {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 35%, var(--border));
}

.toast.success {
  color: var(--success);
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.22s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.96);
}
</style>
