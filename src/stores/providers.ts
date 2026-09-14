import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { effectiveAbilities, type ModelAbilities } from '@/lib/abilities'

/**
 * 模型服务商配置（Cherry Studio 模式：用户自己填 baseURL + Key + 模型列表）。
 * 当前持久化在 localStorage；套壳阶段把 apiKey 迁到安全存储
 * （@capacitor-community 的 secure storage 系插件，走 Android Keystore）。
 */

/** 接口协议类型 */
export type ApiStyle = 'openai' | 'anthropic' | 'gemini'

export interface ProviderConfig {
  id: string
  name: string
  baseURL: string
  apiKey: string
  models: string[]
  enabled: boolean
  apiStyle: ApiStyle
  /** 模型能力手动覆盖：key 为模型名，值覆盖自动检测结果 */
  capabilityOverrides?: Record<string, { vision?: boolean; reasoning?: boolean }>
}

/** 常用服务商模板，添加时一键填充 */
export const PROVIDER_PRESETS: Array<Pick<ProviderConfig, 'name' | 'baseURL' | 'apiStyle'>> = [
  { name: 'DeepSeek', baseURL: 'https://api.deepseek.com', apiStyle: 'openai' },
  { name: '硅基流动', baseURL: 'https://api.siliconflow.cn', apiStyle: 'openai' },
  { name: 'OpenAI', baseURL: 'https://api.openai.com', apiStyle: 'openai' },
  { name: 'Moonshot', baseURL: 'https://api.moonshot.cn', apiStyle: 'openai' },
  { name: '智谱 GLM', baseURL: 'https://open.bigmodel.cn', apiStyle: 'openai' },
  { name: 'OpenRouter', baseURL: 'https://openrouter.ai/api', apiStyle: 'openai' },
  { name: 'Anthropic', baseURL: 'https://api.anthropic.com', apiStyle: 'anthropic' },
  { name: 'Gemini', baseURL: 'https://generativelanguage.googleapis.com', apiStyle: 'gemini' },
  { name: 'Ollama 本地', baseURL: 'http://localhost:11434', apiStyle: 'openai' },
]

const STORAGE_KEY = 'mofa.providers'

function load(): ProviderConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    /* ignore */
  }
  return []
}

export const useProvidersStore = defineStore('providers', () => {
  const providers = ref<ProviderConfig[]>(load())

  watch(
    providers,
    (v) => localStorage.setItem(STORAGE_KEY, JSON.stringify(v)),
    { deep: true },
  )

  function save(p: ProviderConfig) {
    const i = providers.value.findIndex((x) => x.id === p.id)
    if (i >= 0) providers.value[i] = p
    else providers.value.push(p)
  }

  function remove(id: string) {
    providers.value = providers.value.filter((p) => p.id !== id)
  }

  // ---- 当前选中的 模型 ----
  const selected = ref<{ providerId: string; model: string }>(loadSelected())

  function loadSelected(): { providerId: string; model: string } {
    try {
      return JSON.parse(localStorage.getItem('mofa.selected') || 'null') ?? { providerId: '', model: '' }
    } catch {
      return { providerId: '', model: '' }
    }
  }

  watch(selected, (v) => localStorage.setItem('mofa.selected', JSON.stringify(v)), {
    deep: true,
  })

  /** 计算实际生效的 provider + model（选中项失效时自动回退到第一个可用项） */
  const selectedConfig = computed<{ provider: ProviderConfig; model: string } | null>(() => {
    const enabled = providers.value.filter((p) => p.enabled && p.models.length > 0)
    if (!enabled.length) return null
    const picked = enabled.find((p) => p.id === selected.value.providerId)
    if (picked && picked.models.includes(selected.value.model)) {
      return { provider: picked, model: selected.value.model }
    }
    if (picked) return { provider: picked, model: picked.models[0] }
    return { provider: enabled[0], model: enabled[0].models[0] }
  })

  /** 查询某模型的生效能力（自动检测 + 手动覆盖） */
  function abilitiesOf(providerId: string, model: string): ModelAbilities {
    const p = providers.value.find((x) => x.id === providerId)
    return effectiveAbilities(model, p?.capabilityOverrides?.[model])
  }

  /** 切换某模型的指定能力（相对当前生效值取反，写入覆盖） */
  function toggleAbility(providerId: string, model: string, key: keyof ModelAbilities) {
    const p = providers.value.find((x) => x.id === providerId)
    if (!p) return
    const current = effectiveAbilities(model, p.capabilityOverrides?.[model])
    const next = !current[key]
    const overrides = { ...p.capabilityOverrides }
    const o = { ...overrides[model] }
    o[key] = next
    overrides[model] = o
    p.capabilityOverrides = overrides
  }

  return { providers, selected, selectedConfig, abilitiesOf, toggleAbility, save, remove }
})
