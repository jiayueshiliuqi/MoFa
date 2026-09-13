import { ref } from 'vue'

export interface ToastItem {
  id: number
  text: string
  type: 'info' | 'warn' | 'error' | 'success'
}

// 模块级单例，任意组件调用 useToast() 共享同一份队列
const toasts = ref<ToastItem[]>([])
let seq = 0

export function useToast() {
  function show(text: string, type: ToastItem['type'] = 'info', duration = 2400) {
    const id = ++seq
    toasts.value.push({ id, text, type })
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, duration)
  }

  return { toasts, show }
}
