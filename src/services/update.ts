import { App } from '@capacitor/app'
import { APP_VERSION_FALLBACK, UPDATE_BASE } from '@/config'

export interface UpdateInfo {
  version: string
  /** APK 下载地址 */
  url: string
  changelog?: string
}

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

export type CheckResult =
  | { status: 'update'; info: UpdateInfo }
  | { status: 'latest' }
  | { status: 'error' }

/** 检查更新：区分「有更新 / 已最新 / 检查失败」（失败不再被谎报为"已最新"） */
export async function checkUpdate(): Promise<CheckResult> {
  try {
    const [local, res] = await Promise.all([
      currentVersion(),
      fetch(`${UPDATE_BASE}/latest.json?t=${Date.now()}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      }),
    ])
    if (!res.ok) return { status: 'error' }
    const info = (await res.json()) as UpdateInfo
    if (!info?.version || !info?.url) return { status: 'error' }
    return isNewerVersion(info.version, local)
      ? { status: 'update', info }
      : { status: 'latest' }
  } catch {
    return { status: 'error' }
  }
}

/** 下载并安装：原生环境走系统下载器；浏览器回退为打开链接 */
export async function downloadAndInstall(url: string): Promise<'native' | 'browser'> {
  const plugins = (window as unknown as { Capacitor?: { Plugins?: Record<string, { downloadAndInstall: (o: { url: string }) => Promise<void> }> } })
    .Capacitor?.Plugins
  if (plugins?.Updater) {
    await plugins.Updater.downloadAndInstall({ url })
    return 'native'
  }
  window.open(url, '_blank')
  return 'browser'
}
