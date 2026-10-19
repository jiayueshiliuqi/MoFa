<script setup lang="ts">
import { onMounted } from 'vue'
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import router from '@/router'
import { useSettingsStore } from '@/stores/settings'
import { handleBack } from '@/composables/useBackHandler'
import { useDialog } from '@/composables/useDialog'
import { reportAppOpen } from '@/services/stats'
import {
  clearUpdateCache,
  installPermissionGranted,
  requestInstallPermission,
} from '@/services/update'
import ToastHost from '@/components/ui/Toast.vue'
import DialogHost from '@/components/ui/DialogHost.vue'
import UpdateProgress from '@/components/ui/UpdateProgress.vue'

// 实例化 settings store 以在启动时应用主题
const settings = useSettingsStore()

/** 启动时最多提示一次安装权限（用户拒绝后不再每次打扰，更新时仍会再问） */
const INSTALL_PERMISSION_ASKED = 'mofa.installPermissionAsked'

async function maybeAskInstallPermission() {
  if (!Capacitor.isNativePlatform()) return
  // 上次更新装完后，缓存里的安装包会残留到这里清理
  void clearUpdateCache()
  try {
    if (await installPermissionGranted()) {
      localStorage.removeItem(INSTALL_PERMISSION_ASKED)
      return
    }
  } catch {
    return
  }
  if (localStorage.getItem(INSTALL_PERMISSION_ASKED)) return
  // 等首页的静默更新检查先落地，避免两个对话框互相顶掉
  await new Promise((r) => setTimeout(r, 2500))
  const dialog = useDialog()
  if (dialog.current.value) return // 已有别的对话框，下次启动再问
  localStorage.setItem(INSTALL_PERMISSION_ASKED, '1')
  const go = await dialog.confirm('开启应用内更新', {
    message:
      '允许 MoFa 安装应用后，更新下载完成即可直接安装，不用再跳转设置。该权限只用于安装你确认的更新包。',
    confirmText: '去开启',
  })
  if (go) {
    try {
      await requestInstallPermission()
    } catch {
      /* 少数 ROM 没有该设置页，忽略 */
    }
  }
}

onMounted(() => {
  // 匿名使用统计（可在设置中关闭）
  void reportAppOpen(settings.statsEnabled)

  // 启动时请求一次安装权限（未授权才提示）
  void maybeAskInstallPermission()

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
