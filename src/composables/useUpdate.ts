import { ref } from 'vue'
import { checkUpdate, currentVersion, downloadAndInstall } from '@/services/update'
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

  async function runCheck(silent: boolean) {
    if (silent && autoChecked) return
    if (silent) autoChecked = true
    if (checking.value) return
    checking.value = true
    const toast = useToast()
    try {
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
      // 应用内下载：进度浮层由 UpdateProgress 组件展示
      showUpdateProgress(info.version)
      try {
        const how = await downloadAndInstall(info.url, (p) => applyUpdateProgress(p))
        if (how === 'native') {
          setUpdatePhase('installing')
          // 给安装器弹出留一点时间，再把浮层收起（此时应用会切到系统安装界面）
          setTimeout(hideUpdateProgress, 1600)
        } else {
          hideUpdateProgress()
        }
      } catch (e) {
        hideUpdateProgress()
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
