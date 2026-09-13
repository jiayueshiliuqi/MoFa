import { ref } from 'vue'

/**
 * 应用内对话框（替代 window.prompt / window.confirm）。
 * 原生对话框在 WebView 里按钮是英文、风格不统一，且部分环境不支持。
 * 模块级单例：DialogHost 渲染，任意组件调用。
 */
export interface DialogState {
  kind: 'prompt' | 'confirm'
  title: string
  /** 标题下的说明文字（如更新日志） */
  message?: string
  value?: string
  placeholder?: string
  confirmText?: string
  danger?: boolean
  resolve: (v: string | boolean | null) => void
}

const current = ref<DialogState | null>(null)

export function useDialog() {
  /** 输入框对话框：返回输入内容，取消返回 null */
  function prompt(title: string, opts: { value?: string; placeholder?: string } = {}): Promise<string | null> {
    return new Promise((resolve) => {
      current.value = {
        kind: 'prompt',
        title,
        ...opts,
        resolve: (v) => resolve(typeof v === 'string' ? v : null),
      }
    })
  }

  /** 确认对话框：返回是否确认 */
  function confirm(
    title: string,
    opts: { message?: string; confirmText?: string; danger?: boolean } = {},
  ): Promise<boolean> {
    return new Promise((resolve) => {
      current.value = {
        kind: 'confirm',
        title,
        ...opts,
        resolve: (v) => resolve(v === true),
      }
    })
  }

  function settle(v: string | boolean | null) {
    current.value?.resolve(v)
    current.value = null
  }

  return { current, prompt, confirm, settle }
}
