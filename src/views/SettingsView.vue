<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useSettingsStore, type ThemeMode } from '@/stores/settings'
import { useProvidersStore } from '@/stores/providers'
import { useUpdate } from '@/composables/useUpdate'
import Icon from '@/components/ui/Icon.vue'

const router = useRouter()
const settings = useSettingsStore()
const providers = useProvidersStore()
const update = useUpdate()

onMounted(() => update.init())

const themeOptions: Array<{ value: ThemeMode; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]
</script>

<template>
  <div class="settings-page">
    <header class="topbar">
      <button class="icon-btn" aria-label="返回" @click="router.back()">
        <Icon name="back" :size="21" />
      </button>
      <div class="topbar-title">设置</div>
      <div class="topbar-spacer" />
    </header>

    <div class="settings-body">
      <!-- 主题 -->
      <div class="group">
        <div class="group-label">外观</div>
        <div class="segmented">
          <button
            v-for="opt in themeOptions"
            :key="opt.value"
            class="seg-item"
            :class="{ active: settings.theme === opt.value }"
            @click="settings.theme = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <!-- 模型服务 -->
      <div class="group">
        <div class="group-label-row">
          <div class="group-label">模型服务</div>
          <button class="add-btn" @click="router.push('/settings/provider/new')">
            <Icon name="plus" :size="15" />
            添加
          </button>
        </div>

        <button
          v-for="p in providers.providers"
          :key="p.id"
          class="provider-item"
          @click="router.push(`/settings/provider/${p.id}`)"
        >
          <div class="provider-info">
            <div class="provider-name">
              <span class="status-dot" :class="p.enabled ? 'on' : 'off'" />
              {{ p.name }}
            </div>
            <div class="provider-meta">{{ p.models.length }} 个模型 · {{ p.baseURL }}</div>
          </div>
          <Icon name="back" :size="16" class="arrow" />
        </button>

        <button v-if="!providers.providers.length" class="provider-empty" @click="router.push('/settings/provider/new')">
          <Icon name="plus" :size="16" />
          添加你的第一个服务商（DeepSeek / OpenAI / 硅基流动…）
        </button>
      </div>

      <!-- 关于 -->
      <div class="group">
        <div class="group-label">关于</div>
        <div class="about-card">
          <div class="about-row"><span>版本</span><span class="dim">v{{ update.version.value }}</span></div>
          <button class="about-row update-row" @click="update.runCheck(false)">
            <span>检查更新</span>
            <span class="dim">{{ update.checking.value ? '检查中…' : '' }}</span>
          </button>
          <div class="about-row"><span>技术栈</span><span class="dim">Vue 3 · Vite · Capacitor</span></div>
        </div>
        <div class="about-note">
          数据全部保存在本地（IndexedDB），API Key 仅存于本设备。
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
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

.settings-body {
  flex: 1;
  overflow-y: auto;
  max-width: var(--content-max-w);
  width: 100%;
  margin: 0 auto;
  padding: 16px 16px calc(30px + var(--safe-bottom));
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.group-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-tertiary);
  margin-bottom: 8px;
}

.group-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.group-label-row .group-label {
  margin-bottom: 0;
}

.add-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 13px;
  font-weight: 500;
}

.segmented {
  display: flex;
  padding: 3px;
  background: var(--bg-input);
  border-radius: var(--radius);
}

.seg-item {
  flex: 1;
  padding: 8px 0;
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

.provider-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  padding: 13px 14px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  margin-bottom: 8px;
}

.provider-item:active {
  background: var(--bg-hover);
}

.provider-info {
  flex: 1;
  min-width: 0;
}

.provider-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 550;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.on {
  background: var(--success);
}

.status-dot.off {
  background: var(--border-strong);
}

.provider-meta {
  margin-top: 3px;
  font-size: 12.5px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.arrow {
  transform: rotate(180deg);
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.provider-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  width: 100%;
  padding: 16px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-lg);
  font-size: 13.5px;
  color: var(--text-secondary);
}

.about-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 4px 14px;
}

.about-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 0;
  font-size: 14px;
}

.about-row + .about-row {
  border-top: 1px solid var(--border);
}

.dim {
  color: var(--text-tertiary);
  font-size: 13px;
}

.update-row {
  width: 100%;
  text-align: left;
  color: var(--text);
}

.update-row:active {
  background: var(--bg-hover);
}

.about-note {
  margin-top: 10px;
  font-size: 12.5px;
  color: var(--text-tertiary);
  text-align: center;
}
</style>
