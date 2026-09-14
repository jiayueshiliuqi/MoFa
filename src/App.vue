<script setup lang="ts">
import { onMounted } from 'vue'
import { App } from '@capacitor/app'
import { useSettingsStore } from '@/stores/settings'
import { handleBack } from '@/composables/useBackHandler'
import { reportAppOpen } from '@/services/stats'
import ToastHost from '@/components/ui/Toast.vue'
import DialogHost from '@/components/ui/DialogHost.vue'

// 实例化 settings store 以在启动时应用主题
const settings = useSettingsStore()

onMounted(() => {
  // 匿名使用统计（可在设置中关闭）
  void reportAppOpen(settings.statsEnabled)

  // Android 返回键：先让弹层/抽屉消费，都没有则退出应用（web 环境无此事件）
  App.addListener('backButton', () => {
    if (!handleBack()) App.exitApp()
  }).catch(() => {
    /* web 环境不支持，忽略 */
  })
})
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
