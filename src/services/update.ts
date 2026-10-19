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
  /** 是否已允许安装未知应用 */
  hasInstallPermission(): Promise<{ granted: boolean }>
  /** 跳转「安装未知应用」设置页（系统不支持请求弹窗，只能由用户手动打开） */
  requestInstallPermission(): Promise<{ granted?: boolean; started?: boolean }>
  /** 清理缓存里遗留的更新安装包 */
  clearUpdateCache(): Promise<{ removed: number }>
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

/** 原生端是否已获得「安装未知应用」权限（浏览器环境视为已获得） */
export async function installPermissionGranted(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true
  try {
    const res = await Updater.hasInstallPermission()
    return res.granted === true
  } catch {
    // 旧版本插件没有该方法时按已授权处理，避免把更新流程卡死
    return true
  }
}

/** 跳转系统「安装未知应用」设置页（系统不允许应用直接弹权限框） */
export async function requestInstallPermission(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  await Updater.requestInstallPermission()
}

/** 清理上次更新遗留在缓存里的安装包（启动时调用） */
export async function clearUpdateCache(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await Updater.clearUpdateCache()
  } catch {
    /* 清理失败不影响使用 */
  }
}

/**
 * 待继续的更新：用户去系统设置开「安装未知应用」时，Android 会杀掉本进程，
 * 授权流程必须落盘，回到应用后才能自动续上（不会再下载一遍）。
 */
const PENDING_UPDATE_KEY = 'mofa.pendingUpdate'
/** 超过这个时间未完成就丢弃，避免很久以后突然自动更新 */
const PENDING_TTL_MS = 10 * 60 * 1000

export function savePendingUpdate(info: UpdateInfo): void {
  try {
    localStorage.setItem(PENDING_UPDATE_KEY, JSON.stringify({ ...info, savedAt: Date.now() }))
  } catch {
    /* 隐私模式等写入失败时忽略，最多是授权后需要重新点一次 */
  }
}

export function loadPendingUpdate(): UpdateInfo | null {
  try {
    const raw = localStorage.getItem(PENDING_UPDATE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<UpdateInfo> & { savedAt?: number }
    if (typeof parsed.version !== 'string' || typeof parsed.url !== 'string') {
      localStorage.removeItem(PENDING_UPDATE_KEY)
      return null
    }
    if (Date.now() - (parsed.savedAt ?? 0) > PENDING_TTL_MS) {
      localStorage.removeItem(PENDING_UPDATE_KEY)
      return null
    }
    return { version: parsed.version, url: parsed.url, changelog: parsed.changelog }
  } catch {
    return null
  }
}

export function clearPendingUpdate(): void {
  try {
    localStorage.removeItem(PENDING_UPDATE_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * 等待应用从系统设置回到前台。
 * 监听 Capacitor 的 appStateChange，并以 visibilitychange 兜底（部分 ROM 只触发其一）。
 */
export function waitForAppActive(timeout = 120000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    let handle: PluginListenerHandle | null = null
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      void handle?.remove()
      resolve()
    }
    const onVisible = () => {
      if (!document.hidden) setTimeout(finish, 400)
    }
    const timer = setTimeout(finish, timeout)
    document.addEventListener('visibilitychange', onVisible)
    void App.addListener('appStateChange', (state) => {
      if (state.isActive) setTimeout(finish, 400)
    })
      .then((h) => {
        handle = h
        if (settled) void h.remove()
      })
      .catch(() => {
        /* 浏览器环境没有该事件，visibilitychange 足够 */
      })
  })
}
