import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export type ThemeMode = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'mofa.settings'

interface PersistedSettings {
  theme: ThemeMode
  /** 匿名使用统计开关（仅上报版本/平台/随机安装ID） */
  statsEnabled: boolean
}

function load(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { theme: 'system', statsEnabled: true, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return { theme: 'system', statsEnabled: true }
}

function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export const useSettingsStore = defineStore('settings', () => {
  const persisted = load()
  const theme = ref<ThemeMode>(persisted.theme)
  const statsEnabled = ref(persisted.statsEnabled)

  function apply() {
    document.documentElement.dataset.theme = resolveTheme(theme.value)
  }

  // 跟随系统时，监听系统主题变化
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (theme.value === 'system') apply()
  })

  watch(
    [theme, statsEnabled],
    ([t, s]) => {
      apply()
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: t, statsEnabled: s }))
    },
    { immediate: true },
  )

  return { theme, statsEnabled, apply }
})
