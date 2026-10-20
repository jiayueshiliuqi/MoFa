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
    // WebView 自带底色由原生主题推导（浅色偏白 / 深色 #121212），和页面 --bg 不一致时，
    // WebView 重新合成画面的瞬间就会「闪」一下。设为全透明，让它露出的一直是
    // styles.xml 里 AppTheme.NoActionBar 的 windowBackground（与页面 --bg 完全相同）
    backgroundColor: '#00000000',
  },
}

export default config
