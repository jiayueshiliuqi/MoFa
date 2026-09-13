<script setup lang="ts">
import { useSettingsStore } from '@/stores/settings'
import ToastHost from '@/components/ui/Toast.vue'
import DialogHost from '@/components/ui/DialogHost.vue'

// 实例化 settings store 以在启动时应用主题
useSettingsStore()
</script>

<template>
  <router-view v-slot="{ Component }">
    <Transition name="fade" mode="out-in">
      <component :is="Component" />
    </Transition>
  </router-view>
  <ToastHost />
  <DialogHost />
</template>
