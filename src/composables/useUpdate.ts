import { ref } from 'vue'
import { checkUpdate, currentVersion, downloadAndInstall } from '@/services/update'
import { useDialog } from './useDialog'
import { useToast } from './useToast'

/** 更新检查（启动静默检查 + 设置页手动检查共用） */
// 模块级：自动检查每次应用会话只执行一次（ChatView 每次回首页都会重新挂载）
let autoChecked = false

export function useUpdate() {
  const checking = ref(false)
  const version = ref('…')

  async function init() {
    version.value = await currentVersion()
  }

  async function runCheck(silent: boolean) {
    if (silent && autoChecked) return
    if (silent) autoChecked = true
    if (checking.value) return
    checking.value = true
    try {
      const info = await checkUpdate()
      if (!info) {
        if (!silent) useToast().show('已是最新版本', 'success')
        return
      }
      const dialog = useDialog()
      const ok = await dialog.confirm(`发现新版本 v${info.version}`, {
        confirmText: '立即更新',
        message: (info.changelog ?? '').trim() || '优化体验与问题修复。',
      })
      if (!ok) return
      const how = await downloadAndInstall(info.url)
      if (how === 'native') {
        useToast().show('已开始下载，完成后将自动弹出安装', 'info', 4000)
      }
    } finally {
      checking.value = false
    }
  }

  return { checking, version, init, runCheck }
}
