import { STATS_BASE } from '@/config'
import { isIos, isNative } from '@/lib/platform'
import { currentVersion } from './update'

/**
 * 匿名使用统计（可关闭，见设置 → 隐私）。
 *
 * 实现方式刻意做到最轻：只有 nginx 记录请求日志，服务器上不需要任何后端代码。
 * 上报内容仅三项：随机安装 ID、App 版本、平台。不采集聊天内容、API Key、设备信息。
 */

const ID_KEY = 'mofa.installId'

/** 随机安装 ID：首次启动生成并本地持久化，清除数据后会重新生成 */
function installId(): string {
  let id = localStorage.getItem(ID_KEY)
  if (!id) {
    id =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    localStorage.setItem(ID_KEY, id)
  }
  return id
}

function platformLabel(): string {
  if (isNative) return isIos ? 'ios-app' : 'android-app'
  return isIos ? 'ios-web' : 'web'
}

/** 上报一次启动（失败静默，绝不影响使用） */
export async function reportAppOpen(enabled: boolean): Promise<void> {
  if (!enabled) return
  try {
    const version = await currentVersion()
    const url =
      `${STATS_BASE}/hit?e=open&v=${encodeURIComponent(version)}` +
      `&p=${platformLabel()}&id=${encodeURIComponent(installId())}`

    // sendBeacon 不阻塞、页面关闭也不会丢；回退到 no-cors fetch（不需要服务端 CORS 头）
    if (typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(url)
      return
    }
    void fetch(url, { mode: 'no-cors', keepalive: true }).catch(() => undefined)
  } catch {
    /* 统计失败不影响任何功能 */
  }
}
