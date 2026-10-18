import { ref } from 'vue'
import { checkUpdate, currentVersion, downloadAndInstall } from '@/services/update'
import { useDialog } from './useDialog'
import { useToast } from './useToast'

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
      const how = await downloadAndInstall(info.url)
      if (how === 'native') {
        toast.show('已开始下载，完成后将自动弹出安装', 'info', 4000)
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
