/**
 * Android 返回键处理栈（App.vue 的 backButton 事件从栈顶消费）。
 * 各弹层/抽屉打开时注册 handler，关闭时注销。
 */
type BackHandler = () => boolean

const stack: BackHandler[] = []

export function useBackHandler() {
  /** 注册一个返回处理；返回 true 表示已消费。返回注销函数。 */
  function register(h: BackHandler): () => void {
    stack.push(h)
    return () => {
      const i = stack.indexOf(h)
      if (i >= 0) stack.splice(i, 1)
    }
  }
  return { register }
}

/** 供 backButton 事件调用：返回是否被消费 */
export function handleBack(): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    try {
      if (stack[i]()) return true
    } catch {
      stack.splice(i, 1)
    }
  }
  return false
}
