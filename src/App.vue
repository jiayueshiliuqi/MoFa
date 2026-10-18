<script setup lang="ts">
import { onMounted } from 'vue'
import { App } from '@capacitor/app'
import router from '@/router'
import { useSettingsStore } from '@/stores/settings'
import { handleBack } from '@/composables/useBackHandler'
import { reportAppOpen } from '@/services/stats'
import ToastHost from '@/components/ui/Toast.vue'
import DialogHost from '@/components/ui/DialogHost.vue'
import UpdateProgress from '@/components/ui/UpdateProgress.vue'

// 实例化 settings store 以在启动时应用主题
const settings = useSettingsStore()

onMounted(() => {
  // 匿名使用统计（可在设置中关闭）
  void reportAppOpen(settings.statsEnabled)

  // Android 返回键：弹层 > 二级页面返回 > 退出应用（web 环境无此事件）
  App.addListener('backButton', () => {
    if (handleBack()) return
    if (router.currentRoute.value.path !== '/') {
      // 二级页面（设置/编辑服务商）按返回 = 回上一页，而不是杀掉应用丢失未保存表单
      // history.state.back 由 vue-router 维护，深链进入时为 null，直接回首页
      if (window.history.state?.back) router.back()
      else router.push('/')
      return
    }
    App.exitApp()
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
  <UpdateProgress />
</template>
