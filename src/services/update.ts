import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { App } from '@capacitor/app'
import { APP_VERSION_FALLBACK, UPDATE_BASE } from '@/config'

export interface UpdateInfo {
  version: string
  /** APK 下载地址 */
  url: string
  changelog?: string
}

/** 应用内下载进度（由原生插件上报） */
export interface DownloadProgress {
  /** 0~100 */
  progress: number
  /** 已下载字节数 */
  received: number
  /** 文件总字节数（0 表示未知） */
  total: number
}

/** 原生更新插件（android/app/src/main/java/com/mofa/chat/Updater.java） */
interface UpdaterPlugin {
  /** 原生 HTTP GET，绕开 WebView 的 CORS 与混合内容限制 */
  fetchJson(options: { url: string; timeout?: number }): Promise<{ body: string }>
  /** 应用内下载 APK；完成后调起系统安装器 */
  downloadAndInstall(options: { url: string }): Promise<void>
  /** 取消正在进行的下载 */
  cancelDownload(): Promise<void>
  addListener(
    eventName: 'downloadProgress',
    listener: (data: DownloadProgress) => void,
  ): Promise<PluginListenerHandle>
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

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return { status: 'error' }
  }
  // latest.json 可能被改坏：类型不对时按检查失败处理，而不是让 replace 抛到外面
  const info = parsed as Partial<UpdateInfo> | null
  if (typeof info?.version !== 'string' || typeof info?.url !== 'string') return { status: 'error' }
  try {
    const u = new URL(info.url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { status: 'error' }
  } catch {
    return { status: 'error' }
  }

  return isNewerVersion(info.version, local)
    ? { status: 'update', info: info as UpdateInfo }
    : { status: 'latest' }
}

/** 下载并安装：原生环境走应用内下载（带进度），完成后调起系统安装器；浏览器回退为打开链接 */
export async function downloadAndInstall(
  url: string,
  onProgress?: (p: DownloadProgress) => void,
): Promise<'native' | 'browser'> {
  if (Capacitor.isNativePlatform()) {
    const handle = onProgress
      ? await Updater.addListener('downloadProgress', (data) => onProgress(data))
      : null
    try {
      await Updater.downloadAndInstall({ url })
      return 'native'
    } finally {
      await handle?.remove()
    }
  }
  window.open(url, '_blank')
  return 'browser'
}

/** 取消应用内更新下载（原生端；没有正在下载时静默忽略） */
export async function cancelUpdateDownload(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await Updater.cancelDownload()
  } catch {
    /* 没有活跃下载时插件可能直接 reject，忽略 */
  }
}
