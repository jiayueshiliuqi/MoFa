import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export type ThemeMode = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'mofa.settings'

interface PersistedSettings {
  theme: ThemeMode
}

function load(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { theme: 'system', ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return { theme: 'system' }
}

function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export const useSettingsStore = defineStore('settings', () => {
  const persisted = load()
  const theme = ref<ThemeMode>(persisted.theme)

  function apply() {
    document.documentElement.dataset.theme = resolveTheme(theme.value)
  }

  // 跟随系统时，监听系统主题变化
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (theme.value === 'system') apply()
  })

  watch(
    theme,
    (v) => {
      apply()
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: v }))
    },
    { immediate: true },
  )

  return { theme, apply }
})
