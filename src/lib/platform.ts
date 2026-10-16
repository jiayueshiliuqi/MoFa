import { Capacitor } from '@capacitor/core'

/** 是否运行在原生壳（Android / iOS App）中 */
export const isNative = Capacitor.isNativePlatform()

/** 用系统方式打开外部链接：原生壳走桥接（系统浏览器），网页端新开标签页 */
export function openExternal(url: string) {
  if (!/^https?:\/\//.test(url)) return
  if (isNative) {
    // Capacitor 桥接了 window.open：原生端会拉起系统浏览器
    window.open(url, '_blank')
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

/** 是否 iOS 设备（含 iPadOS） */
export const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)

/** 是否已作为「主屏幕应用」运行（PWA 独立窗口模式） */
export const isStandalone =
  (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
  window.matchMedia('(display-mode: standalone)').matches

/** 是否 iOS 上尚未添加到主屏幕的 Safari 用户（需要引导） */
export const needsIosInstallHint = isIos && !isStandalone && !isNative
