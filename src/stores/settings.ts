import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { SearchEnginePref } from '@/services/websearch'

export type ThemeMode = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'mofa.settings'

interface PersistedSettings {
  theme: ThemeMode
  /** 匿名使用统计开关（仅上报版本/平台/随机安装ID） */
  statsEnabled: boolean
  /** 联网搜索引擎 */
  searchEngine: SearchEnginePref
  /** 搜索结果条数 */
  searchMaxResults: number
  /** 是否抓取网页正文（更准但更慢） */
  searchFullText: boolean
  /** SearXNG 实例地址（自建或公共实例） */
  searxngUrl: string
}

const DEFAULTS: PersistedSettings = {
  theme: 'system',
  statsEnabled: true,
  searchEngine: 'auto',
  searchMaxResults: 5,
  searchFullText: true,
  searxngUrl: '',
}

function load(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<PersistedSettings> | null
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULTS }
    // 逐项校验：损坏的存储不能让「关闭统计」这类隐私开关失效
    const theme: ThemeMode =
      parsed.theme === 'light' || parsed.theme === 'dark' || parsed.theme === 'system'
        ? parsed.theme
        : DEFAULTS.theme
    const engine: SearchEnginePref =
      parsed.searchEngine === 'bing' ||
      parsed.searchEngine === 'duckduckgo' ||
      parsed.searchEngine === 'searxng' ||
      parsed.searchEngine === 'auto'
        ? parsed.searchEngine
        : DEFAULTS.searchEngine
    const max = Number(parsed.searchMaxResults)
    return {
      theme,
      // 无法确认时按「关闭」处理，避免误报
      statsEnabled: typeof parsed.statsEnabled === 'boolean' ? parsed.statsEnabled : false,
      searchEngine: engine,
      searchMaxResults: [3, 5, 8].includes(max) ? max : DEFAULTS.searchMaxResults,
      searchFullText:
        typeof parsed.searchFullText === 'boolean' ? parsed.searchFullText : DEFAULTS.searchFullText,
      searxngUrl: typeof parsed.searxngUrl === 'string' ? parsed.searxngUrl : '',
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS }
}

function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export const useSettingsStore = defineStore('settings', () => {
  const persisted = load()
  const theme = ref<ThemeMode>(persisted.theme)
  const statsEnabled = ref(persisted.statsEnabled)
  const searchEngine = ref<SearchEnginePref>(persisted.searchEngine)
  const searchMaxResults = ref(persisted.searchMaxResults)
  const searchFullText = ref(persisted.searchFullText)
  const searxngUrl = ref(persisted.searxngUrl)

  function apply() {
    document.documentElement.dataset.theme = resolveTheme(theme.value)
  }

  // 跟随系统时，监听系统主题变化
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (theme.value === 'system') apply()
  })

  watch(
    [theme, statsEnabled, searchEngine, searchMaxResults, searchFullText, searxngUrl],
    ([t, s, engine, max, full, url]) => {
      apply()
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          theme: t,
          statsEnabled: s,
          searchEngine: engine,
          searchMaxResults: max,
          searchFullText: full,
          searxngUrl: url,
        }),
      )
    },
    { immediate: true },
  )

  return { theme, statsEnabled, searchEngine, searchMaxResults, searchFullText, searxngUrl, apply }
})
