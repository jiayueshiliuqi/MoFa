<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useProvidersStore } from '@/stores/providers'
import Icon from '@/components/ui/Icon.vue'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const router = useRouter()
const providers = useProvidersStore()

function pick(providerId: string, model: string) {
  providers.selected = { providerId, model }
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="backdrop" @click="emit('close')" />
    </Transition>
    <Transition name="slide-up">
      <div v-if="open" class="sheet">
        <div class="sheet-bar" />
        <div class="sheet-scroll">
          <template v-for="p in providers.providers.filter((x) => x.enabled)" :key="p.id">
            <div class="group-label">{{ p.name }}</div>
            <button
              v-for="m in p.models"
              :key="p.id + m"
              class="model-item"
              @click="pick(p.id, m)"
            >
              <span class="model-name">
                {{ m }}
                <span
                  v-if="providers.abilitiesOf(p.id, m).vision"
                  class="ability-badge vision"
                >视觉</span>
                <span
                  v-if="providers.abilitiesOf(p.id, m).reasoning"
                  class="ability-badge reasoning"
                >思考</span>
              </span>
              <Icon
                v-if="providers.selectedConfig?.provider.id === p.id && providers.selectedConfig.model === m"
                name="check"
                :size="17"
                class="check"
              />
            </button>
          </template>

          <div v-if="!providers.providers.length" class="empty">
            还没有配置服务商
            <button class="empty-btn" @click="router.push('/settings'); emit('close')">
              去添加
            </button>
          </div>
        </div>
        <button class="manage-btn" @click="router.push('/settings'); emit('close')">
          管理服务商
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 900;
}

.sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  max-height: 68vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-elevated);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  box-shadow: var(--shadow-lg);
  z-index: 901;
  padding-bottom: var(--safe-bottom);
}

.sheet-bar {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: var(--border-strong);
  margin: 10px auto 4px;
}

.sheet-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 6px 10px 8px;
}

.group-label {
  padding: 12px 12px 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.model-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  text-align: left;
  padding: 12px;
  border-radius: var(--radius);
  font-size: 14.5px;
}

.model-item:active {
  background: var(--bg-hover);
}

.model-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ability-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 500;
  vertical-align: 1px;
}

.ability-badge.vision {
  color: #b45309;
  background: rgba(245, 158, 11, 0.14);
}

html[data-theme='dark'] .ability-badge.vision {
  color: #fbbf24;
}

.ability-badge.reasoning {
  color: #7c3aed;
  background: rgba(139, 92, 246, 0.14);
}

html[data-theme='dark'] .ability-badge.reasoning {
  color: #c4b5fd;
}

.check {
  flex-shrink: 0;
  color: var(--accent);
}

.empty {
  padding: 34px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  font-size: 13.5px;
  color: var(--text-tertiary);
}

.empty-btn {
  padding: 8px 20px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--text-on-accent);
  font-size: 13.5px;
}

.manage-btn {
  flex-shrink: 0;
  margin: 0 14px 12px;
  padding: 12px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-card);
  font-size: 14px;
  color: var(--text-secondary);
}
</style>
