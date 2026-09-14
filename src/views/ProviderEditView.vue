<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PROVIDER_PRESETS, useProvidersStore, type ApiStyle, type ProviderConfig } from '@/stores/providers'
import { getAdapter } from '@/services/llm'
import { detectAbilities, effectiveAbilities, type ModelAbilities } from '@/lib/abilities'
import Icon from '@/components/ui/Icon.vue'
import { useToast } from '@/composables/useToast'
import { useDialog } from '@/composables/useDialog'

const route = useRoute()
const router = useRouter()
const providers = useProvidersStore()
const { show } = useToast()
const dialog = useDialog()

const isNew = computed(() => route.params.id === 'new')
const editing = providers.providers.find((p) => p.id === route.params.id)

const form = reactive({
  name: editing?.name ?? '',
  baseURL: editing?.baseURL ?? '',
  apiKey: editing?.apiKey ?? '',
  apiStyle: (editing?.apiStyle ?? 'openai') as ApiStyle,
  enabled: editing?.enabled ?? true,
})

const STYLE_OPTIONS: Array<{ value: ApiStyle; label: string }> = [
  { value: 'openai', label: 'OpenAI 兼容' },
  { value: 'anthropic', label: 'Claude' },
  { value: 'gemini', label: 'Gemini' },
]

/** 深拷贝为普通对象（capabilityOverrides 可能是 Pinia 响应式代理，structuredClone 会抛错） */
function toPlainOverrides(p?: ProviderConfig): Record<string, { vision?: boolean; reasoning?: boolean }> {
  const out: Record<string, { vision?: boolean; reasoning?: boolean }> = {}
  if (p?.capabilityOverrides) {
    for (const [k, v] of Object.entries(p.capabilityOverrides)) out[k] = { ...v }
  }
  return out
}

// 模型能力覆盖（本地编辑，保存时写入）
const abilityOverrides = reactive(toPlainOverrides(editing))

// ---- 模型勾选列表 ----
const availableModels = ref<string[]>(editing ? [...editing.models] : [])
const checked = reactive(new Set<string>(editing?.models ?? []))
const manualInput = ref('')

const checkedList = computed(() => availableModels.value.filter((m) => checked.has(m)))

function toggleCheck(m: string) {
  if (checked.has(m)) checked.delete(m)
  else checked.add(m)
}

function addManual() {
  const m = manualInput.value.trim()
  if (!m) return
  if (!availableModels.value.includes(m)) availableModels.value.push(m)
  checked.add(m)
  manualInput.value = ''
}

function removeCandidate(m: string) {
  if (checked.has(m)) return // 选中的先取消勾选
  availableModels.value = availableModels.value.filter((x) => x !== m)
}

function abilityOf(model: string): ModelAbilities {
  return effectiveAbilities(model, abilityOverrides[model])
}

function toggleAbility(model: string, key: keyof ModelAbilities) {
  const next = !abilityOf(model)[key]
  abilityOverrides[model] = { ...(abilityOverrides[model] ?? {}), [key]: next }
}

const showKey = ref(false)
const testing = ref(false)

function applyPreset(preset: Pick<ProviderConfig, 'name' | 'baseURL' | 'apiStyle'>) {
  form.name = preset.name
  form.baseURL = preset.baseURL
  form.apiStyle = preset.apiStyle
}

async function fillModelsFromAPI() {
  if (!form.baseURL.trim()) {
    show('请先填写 API 地址', 'warn')
    return
  }
  testing.value = true
  try {
    const models = await getAdapter(form.apiStyle).listModels({
      baseURL: form.baseURL.trim(),
      apiKey: form.apiKey.trim(),
    })
    if (!models.length) {
      show('连接成功，但没有返回模型', 'warn')
    } else {
      let added = 0
      for (const m of models) {
        if (!availableModels.value.includes(m)) {
          availableModels.value.push(m)
          checked.add(m) // 新拉取的默认勾选
          added++
        }
      }
      // 一个都没选时全选，避免保存被拦
      if (!checked.size) models.forEach((m) => checked.add(m))
      show(added ? `新增 ${added} 个模型，勾选要启用的` : `模型已是最新（共 ${models.length} 个）`, 'success')
    }
  } catch (e) {
    show(e instanceof Error ? e.message : '连接失败', 'error')
  } finally {
    testing.value = false
  }
}

function save() {
  if (!form.name.trim()) return show('请填写名称', 'warn')
  if (!form.baseURL.trim()) return show('请填写 API 地址', 'warn')
  const models = checkedList.value
  if (!models.length) return show('请至少勾选一个模型', 'warn')

  // 只保留与自动检测不一致的覆盖项
  const overrides: Record<string, { vision?: boolean; reasoning?: boolean }> = {}
  for (const m of models) {
    const o = abilityOverrides[m]
    if (!o) continue
    const eff = effectiveAbilities(m, o)
    const det = detectAbilities(m)
    if (eff.vision !== det.vision || eff.reasoning !== det.reasoning) overrides[m] = o
  }

  providers.save({
    id: editing?.id ?? `p_${Date.now()}`,
    name: form.name.trim(),
    baseURL: form.baseURL.trim(),
    apiKey: form.apiKey.trim(),
    models,
    enabled: form.enabled,
    apiStyle: form.apiStyle,
    capabilityOverrides: Object.keys(overrides).length ? overrides : undefined,
  })
  show('已保存', 'success')
  router.replace('/settings')
}

async function remove() {
  if (!editing) return
  const ok = await dialog.confirm(`删除服务商「${editing.name}」？`, {
    danger: true,
    confirmText: '删除',
  })
  if (!ok) return
  providers.remove(editing.id)
  show('已删除')
  router.replace('/settings')
}
</script>

<template>
  <div class="edit-page">
    <header class="topbar">
      <button class="icon-btn" aria-label="返回" @click="router.back()">
        <Icon name="back" :size="21" />
      </button>
      <div class="topbar-title">{{ isNew ? '添加服务商' : '编辑服务商' }}</div>
      <div class="topbar-spacer" />
    </header>

    <div class="edit-body">
      <!-- 模板（仅新建时） -->
      <template v-if="isNew">
        <div class="group-label">快速模板</div>
        <div class="preset-row">
          <button
            v-for="p in PROVIDER_PRESETS"
            :key="p.name"
            class="preset-chip"
            @click="applyPreset(p)"
          >
            {{ p.name }}
          </button>
        </div>
      </template>

      <div class="field">
        <label class="field-label">接口协议</label>
        <div class="segmented">
          <button
            v-for="opt in STYLE_OPTIONS"
            :key="opt.value"
            class="seg-item"
            :class="{ active: form.apiStyle === opt.value }"
            @click="form.apiStyle = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <div class="field">
        <label class="field-label">名称</label>
        <input v-model="form.name" type="text" placeholder="例如：DeepSeek" />
      </div>

      <div class="field">
        <label class="field-label">API 地址（自动补全 /v1）</label>
        <input v-model="form.baseURL" type="url" placeholder="https://api.deepseek.com" />
      </div>

      <div class="field">
        <label class="field-label">API Key</label>
        <div class="key-row">
          <input
            v-model="form.apiKey"
            :type="showKey ? 'text' : 'password'"
            placeholder="sk-…"
            autocomplete="off"
          />
          <button class="icon-btn" aria-label="显示/隐藏 Key" @click="showKey = !showKey">
            <Icon name="eye" :size="18" />
          </button>
        </div>
      </div>

      <!-- 模型：勾选列表 -->
      <div class="field">
        <div class="field-label-row">
          <label class="field-label">模型（勾选要启用的）</label>
          <button class="fetch-btn" :disabled="testing" @click="fillModelsFromAPI">
            {{ testing ? '获取中…' : '从 API 拉取模型列表' }}
          </button>
        </div>

        <div v-if="availableModels.length" class="model-list">
          <div v-for="m in availableModels" :key="m" class="model-option" :class="{ checked: checked.has(m) }">
            <label class="model-check">
              <input type="checkbox" :checked="checked.has(m)" @change="toggleCheck(m)" />
              <span class="model-option-name">{{ m }}</span>
            </label>
            <span class="model-option-badges">
              <span v-if="abilityOf(m).vision" class="mini-badge vision">视觉</span>
              <span v-if="abilityOf(m).reasoning" class="mini-badge reasoning">思考</span>
            </span>
            <button
              v-if="!checked.has(m)"
              class="model-remove"
              aria-label="从列表移除"
              @click="removeCandidate(m)"
            >
              <Icon name="close" :size="14" />
            </button>
          </div>
        </div>
        <div v-else class="empty-hint">
          填好 API 地址后点上方按钮拉取，或在下方手动添加
        </div>

        <div class="manual-add">
          <input
            v-model="manualInput"
            type="text"
            placeholder="手动添加模型名，回车确认"
            @keydown.enter.prevent="addManual"
          />
        </div>
      </div>

      <div v-if="checkedList.length" class="field">
        <label class="field-label">模型能力（自动识别，点击可修正）</label>
        <div class="ability-list">
          <div v-for="m in checkedList" :key="m" class="ability-row">
            <span class="ability-model">{{ m }}</span>
            <div class="ability-chips">
              <button
                class="ability-chip"
                :class="{ on: abilityOf(m).vision }"
                @click="toggleAbility(m, 'vision')"
              >
                视觉
              </button>
              <button
                class="ability-chip"
                :class="{ on: abilityOf(m).reasoning }"
                @click="toggleAbility(m, 'reasoning')"
              >
                思考
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="field switch-field">
        <label class="field-label">启用</label>
        <button
          class="switch"
          :class="{ on: form.enabled }"
          role="switch"
          :aria-checked="form.enabled"
          @click="form.enabled = !form.enabled"
        >
          <span class="knob" />
        </button>
      </div>

      <div class="btn-row">
        <button class="primary-btn" @click="save">保存</button>
        <button v-if="!isNew" class="danger-btn" @click="remove">删除</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.edit-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.topbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  height: calc(var(--topbar-h) + var(--safe-top));
  padding: var(--safe-top) 8px 0;
  background: color-mix(in srgb, var(--bg) 82%, transparent);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--border);
}

.topbar-title {
  flex: 1;
  text-align: center;
  font-size: 15.5px;
  font-weight: 600;
}

.topbar-spacer {
  width: 36px;
}

.edit-body {
  flex: 1;
  overflow-y: auto;
  max-width: var(--content-max-w);
  width: 100%;
  margin: 0 auto;
  padding: 16px 16px calc(30px + var(--safe-bottom));
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.group-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-tertiary);
}

.preset-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.preset-chip {
  padding: 7px 14px;
  border-radius: 999px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  font-size: 13px;
  color: var(--text-secondary);
}

.preset-chip:active {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 13px;
  font-weight: 550;
  color: var(--text-secondary);
}

.field-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

input[type='text'],
input[type='url'],
input[type='password'] {
  width: 100%;
  padding: 11px 13px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text);
  outline: none;
  transition: border-color 0.15s ease;
}

input:focus {
  border-color: var(--accent);
}

.key-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.key-row input {
  flex: 1;
  font-family: 'JetBrains Mono', Menlo, Consolas, monospace;
  font-size: 13.5px;
}

.fetch-btn {
  font-size: 12.5px;
  color: var(--accent);
  font-weight: 500;
}

.fetch-btn:disabled {
  opacity: 0.5;
}

/* ---- 模型勾选列表 ---- */
.model-list {
  display: flex;
  flex-direction: column;
  max-height: 260px;
  overflow-y: auto;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 2px 12px;
}

.model-option {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 0;
}

.model-option + .model-option {
  border-top: 1px solid var(--border);
}

.model-check {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.model-check input[type='checkbox'] {
  width: 17px;
  height: 17px;
  accent-color: var(--accent);
  flex-shrink: 0;
}

.model-option-name {
  font-size: 13.5px;
  font-family: 'JetBrains Mono', Menlo, Consolas, monospace;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-option:not(.checked) .model-option-name {
  color: var(--text-tertiary);
}

.model-option-badges {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.mini-badge {
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 500;
}

.mini-badge.vision {
  color: #b45309;
  background: rgba(245, 158, 11, 0.14);
}

html[data-theme='dark'] .mini-badge.vision {
  color: #fbbf24;
}

.mini-badge.reasoning {
  color: #7c3aed;
  background: rgba(139, 92, 246, 0.14);
}

html[data-theme='dark'] .mini-badge.reasoning {
  color: #c4b5fd;
}

.model-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.model-remove:active {
  background: var(--bg-active);
  color: var(--danger);
}

.empty-hint {
  padding: 14px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius);
  font-size: 13px;
  color: var(--text-tertiary);
  text-align: center;
}

.manual-add input {
  font-size: 13.5px;
}

/* ---- 协议选择 ---- */
.segmented {
  display: flex;
  padding: 3px;
  background: var(--bg-input);
  border-radius: var(--radius);
}

.seg-item {
  flex: 1;
  padding: 9px 0;
  border-radius: 9px;
  font-size: 13.5px;
  color: var(--text-secondary);
  transition: all 0.18s ease;
}

.seg-item.active {
  background: var(--bg-elevated);
  color: var(--text);
  font-weight: 550;
  box-shadow: var(--shadow-sm);
}

/* ---- 能力修正 ---- */
.ability-list {
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 2px 12px;
}

.ability-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 0;
}

.ability-row + .ability-row {
  border-top: 1px solid var(--border);
}

.ability-model {
  font-size: 13px;
  font-family: 'JetBrains Mono', Menlo, Consolas, monospace;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ability-chips {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.ability-chip {
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-tertiary);
  transition: all 0.15s ease;
}

.ability-chip.on {
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
  color: var(--accent);
  font-weight: 550;
}

.switch-field {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 4px 2px;
}

.switch {
  position: relative;
  width: 46px;
  height: 27px;
  border-radius: 999px;
  background: var(--border-strong);
  transition: background-color 0.2s ease;
}

.switch.on {
  background: var(--accent);
}

.knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 21px;
  height: 21px;
  border-radius: 50%;
  background: #fff;
  box-shadow: var(--shadow-sm);
  transition: transform 0.2s cubic-bezier(0.32, 0.72, 0, 1);
}

.switch.on .knob {
  transform: translateX(19px);
}

.btn-row {
  display: flex;
  gap: 10px;
  margin-top: 6px;
}

.primary-btn {
  flex: 1;
  padding: 13px;
  border-radius: var(--radius);
  background: var(--accent);
  color: var(--text-on-accent);
  font-size: 15px;
  font-weight: 600;
}

.primary-btn:active {
  background: var(--accent-hover);
}

.danger-btn {
  padding: 13px 22px;
  border-radius: var(--radius);
  border: 1px solid color-mix(in srgb, var(--danger) 40%, var(--border));
  color: var(--danger);
  font-size: 15px;
}
</style>
