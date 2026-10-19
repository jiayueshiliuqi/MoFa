import { ref } from 'vue'
import { Capacitor } from '@capacitor/core'
import {
  checkUpdate,
  clearPendingUpdate,
  currentVersion,
  downloadAndInstall,
  installPermissionGranted,
  loadPendingUpdate,
  requestInstallPermission,
  savePendingUpdate,
  waitForAppActive,
  type UpdateInfo,
} from '@/services/update'
import { useDialog } from './useDialog'
import { useToast } from './useToast'
import {
  applyUpdateProgress,
  hideUpdateProgress,
  setUpdatePhase,
  showUpdateProgress,
} from './useUpdateProgress'

/** 更新检查（启动静默检查 + 设置页手动检查共用） */
// 模块级：自动检查每次应用会话只执行一次（ChatView 每次回首页都会重新挂载）
let autoChecked = false
// 模块级共享状态：ChatView 与 SettingsView 各建一个 useUpdate 实例，
// 用模块级 ref 才能互斥（否则可能并发请求、弹两次更新对话框）
const checking = ref(false)
const version = ref('…')

export function useUpdate() {
  async function init() {
    version.value = await currentVersion()
  }

  /**
   * 下载前确认「安装未知应用」权限。
   * 系统不提供运行时权限弹窗，只能跳设置页；返回后自动复核，
   * 这样不会出现「下载完才被拦下、授权后又要重新下载」。
   * 注意：用户打开该权限时 Android 会杀掉本进程，因此提前把待更新信息落盘。
   */
  async function ensureInstallPermission(info: UpdateInfo): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return true
    if (await installPermissionGranted()) {
      clearPendingUpdate()
      return true
    }

    // 授权会导致进程被杀，回来后由启动时的 resumePendingUpdate 继续
    savePendingUpdate(info)
    const dialog = useDialog()
    const go = await dialog.confirm('需要安装权限', {
      message:
        '下载更新前，需要允许 MoFa 安装应用。开启后返回应用会自动继续下载，不需要重新点更新。',
      confirmText: '去开启',
    })
    if (!go) {
      clearPendingUpdate()
      return false
    }
    try {
      await requestInstallPermission()
    } catch {
      clearPendingUpdate()
      return false
    }
    // 用户在设置页停留多久都行；回到前台再复核（授权会杀进程，这条只覆盖未授权返回）
    await waitForAppActive()
    // 少数 ROM 的权限生效有延迟
    for (let i = 0; i < 6; i++) {
      if (await installPermissionGranted()) {
        clearPendingUpdate()
        return true
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    clearPendingUpdate()
    return false
  }

  /** 授权返回后继续上次被系统中断的更新（只在本进程被权限变更杀掉后命中） */
  async function resumePendingUpdate(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false
    const pending = loadPendingUpdate()
    if (!pending) return false
    // 还没授权：保留记录，等用户下次点更新时覆盖
    if (!(await installPermissionGranted())) return false
    clearPendingUpdate()
    showUpdateProgress(pending.version)
    try {
      await downloadAndInstall(pending.url, (p) => applyUpdateProgress(p))
      setUpdatePhase('installing')
      setTimeout(hideUpdateProgress, 1600)
    } catch (e) {
      hideUpdateProgress()
      const msg = e instanceof Error ? e.message : ''
      useToast().show(`更新失败${msg ? '：' + msg.slice(0, 60) : '，请稍后重试'}`, 'error')
    }
    return true
  }

  async function runCheck(silent: boolean) {
    if (silent && autoChecked) return
    if (silent) autoChecked = true
    if (checking.value) return
    checking.value = true
    const toast = useToast()
    try {
      // 静默检查时优先续上「去开权限导致进程被杀」的更新，避免重新下载
      if (silent && (await resumePendingUpdate())) return
      const result = await checkUpdate()
      if (result.status === 'error') {
        if (!silent) toast.show('检查更新失败，请检查网络', 'error')
        return
      }
      if (result.status === 'latest') {
        if (!silent) toast.show('已是最新版本', 'success')
        return
      }
      const info = result.info
      const dialog = useDialog()
      const ok = await dialog.confirm(`发现新版本 v${info.version}`, {
        confirmText: '立即更新',
        message: (info.changelog ?? '').trim() || '优化体验与问题修复。',
      })
      if (!ok) return
      // 原生端先确认安装权限：避免下载完成才被系统拦下，授权后又要重新下载
      if (!(await ensureInstallPermission(info))) {
        toast.show('未开启安装权限，已取消更新', 'info')
        return
      }
      // 应用内下载：进度浮层由 UpdateProgress 组件展示
      showUpdateProgress(info.version)
      try {
        const how = await downloadAndInstall(info.url, (p) => applyUpdateProgress(p))
        if (how === 'native') {
          clearPendingUpdate()
          setUpdatePhase('installing')
          // 给安装器弹出留一点时间，再把浮层收起（此时应用会切到系统安装界面）
          setTimeout(hideUpdateProgress, 1600)
        } else {
          hideUpdateProgress()
        }
      } catch (e) {
        hideUpdateProgress()
        clearPendingUpdate()
        // 用户主动取消不是错误，给个轻提示即可
        if (e instanceof Error && /已取消/.test(e.message)) {
          toast.show('已取消更新', 'info')
          return
        }
        throw e
      }
    } catch (e) {
      // 下载/安装失败要给用户反馈，不能变成未处理 rejection
      const msg = e instanceof Error ? e.message : ''
      toast.show(`更新失败${msg ? '：' + msg.slice(0, 60) : '，请稍后重试'}`, 'error')
    } finally {
      checking.value = false
    }
  }

  return { checking, version, init, runCheck }
}
