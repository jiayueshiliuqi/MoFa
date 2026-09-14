/** 全局配置。发版时同步更新 android/app/build.gradle 的 versionName/versionCode */

export const APP_VERSION_FALLBACK = '0.0.2'

/** 自动更新的服务端地址（latest.json 与 APK 都放这里）。走 HTTPS 避免 WebView 混合内容拦截 */
export const UPDATE_BASE = 'https://yunsmart.cn/share/MoFa'
