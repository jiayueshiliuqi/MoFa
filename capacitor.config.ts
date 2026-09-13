import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor 配置。目前先在浏览器中开发（第 1~2 周），
 * 真机阶段再执行：npx cap add android && npx cap sync
 */
const config: CapacitorConfig = {
  appId: 'com.mofa.chat',
  appName: 'MoFa',
  webDir: 'dist',
}

export default config
