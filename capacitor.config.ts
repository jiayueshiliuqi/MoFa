import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor 配置。目前先在浏览器中开发（第 1~2 周），
 * 真机阶段再执行：npx cap add android && npx cap sync
 */
const config: CapacitorConfig = {
  appId: 'com.mofa.chat',
  appName: 'MoFa',
  webDir: 'dist',
  android: {
    // targetSdk 35 在 Android 15 上强制 edge-to-edge：让 Capacitor 自动给 WebView 补系统栏边距，
    // 否则顶部工具栏会被状态栏盖住、底部输入框会压到手势条下面
    adjustMarginsForEdgeToEdge: 'auto',
  },
}

export default config
