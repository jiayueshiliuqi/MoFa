import { Capacitor } from '@capacitor/core'

/** 是否运行在原生壳（Android / iOS App）中 */
export const isNative = Capacitor.isNativePlatform()

/** 是否 iOS 设备（含 iPadOS） */
export const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)

/** 是否已作为「主屏幕应用」运行（PWA 独立窗口模式） */
export const isStandalone =
  (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
  window.matchMedia('(display-mode: standalone)').matches

/** 是否 iOS 上尚未添加到主屏幕的 Safari 用户（需要引导） */
export const needsIosInstallHint = isIos && !isStandalone && !isNative
