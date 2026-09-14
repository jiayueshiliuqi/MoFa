import { Capacitor, registerPlugin } from '@capacitor/core'
import { App } from '@capacitor/app'
import { APP_VERSION_FALLBACK, UPDATE_BASE } from '@/config'

export interface UpdateInfo {
  version: string
  /** APK 下载地址 */
  url: string
  changelog?: string
}

/** 原生更新插件（android/app/src/main/java/com/mofa/chat/Updater.java） */
interface UpdaterPlugin {
  /** 原生 HTTP GET，绕开 WebView 的 CORS 与混合内容限制 */
  fetchJson(options: { url: string; timeout?: number }): Promise<{ body: string }>
  downloadAndInstall(options: { url: string }): Promise<{ started: boolean }>
}

const Updater = registerPlugin<UpdaterPlugin>('Updater')

/** 获取当前 App 版本（原生环境读包信息；浏览器开发环境回退到常量） */
export async function currentVersion(): Promise<string> {
  try {
    const info = await App.getInfo()
    return info.version || APP_VERSION_FALLBACK
  } catch {
    return APP_VERSION_FALLBACK
  }
}

/** 语义化版本比较：remote > local 返回 true */
export function isNewerVersion(remote: string, local: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/[^0-9.]/g, '')
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0)
  const r = parse(remote)
  const l = parse(local)
  const len = Math.max(r.length, l.length)
  for (let i = 0; i < len; i++) {
    const rv = r[i] ?? 0
    const lv = l[i] ?? 0
    if (rv > lv) return true
    if (rv < lv) return false
  }
  return false
}

/** 拉取版本信息：原生走 Java 层（无跨域限制），浏览器环境走 fetch */
async function fetchLatestJson(): Promise<string | null> {
  const url = `${UPDATE_BASE}/latest.json?t=${Date.now()}`

  if (Capacitor.isNativePlatform()) {
    try {
      const res = await Updater.fetchJson({ url, timeout: 10000 })
      return res.body
    } catch {
      return null
    }
  }

  // 浏览器开发环境：普通 fetch，需要服务端返回 CORS 头
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

export type CheckResult =
  | { status: 'update'; info: UpdateInfo }
  | { status: 'latest' }
  | { status: 'error' }

/** 检查更新：区分「有更新 / 已最新 / 检查失败」 */
export async function checkUpdate(): Promise<CheckResult> {
  const [local, body] = await Promise.all([currentVersion(), fetchLatestJson()])
  if (!body) return { status: 'error' }

  let info: UpdateInfo
  try {
    info = JSON.parse(body) as UpdateInfo
  } catch {
    return { status: 'error' }
  }
  if (!info?.version || !info?.url) return { status: 'error' }

  return isNewerVersion(info.version, local) ? { status: 'update', info } : { status: 'latest' }
}

/** 下载并安装：原生环境走系统下载器；浏览器回退为打开链接 */
export async function downloadAndInstall(url: string): Promise<'native' | 'browser'> {
  if (Capacitor.isNativePlatform()) {
    await Updater.downloadAndInstall({ url })
    return 'native'
  }
  window.open(url, '_blank')
  return 'browser'
}
