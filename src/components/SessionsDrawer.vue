<script setup lang="ts">
import { watch } from 'vue'
import { useRouter } from 'vue-router'
import { useChatStore } from '@/stores/chat'
import { formatSessionTime } from '@/lib/utils'
import Icon from '@/components/ui/Icon.vue'
import { useToast } from '@/composables/useToast'
import { useDialog } from '@/composables/useDialog'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const router = useRouter()
const chat = useChatStore()
const { show } = useToast()
const dialog = useDialog()

// 抽屉打开时禁止背景滚动
watch(
  () => props.open,
  (v) => {
    document.body.style.overflow = v ? 'hidden' : ''
  },
)

function select(id: number) {
  chat.openSession(id)
  emit('close')
}

function newChat() {
  chat.newSession()
  emit('close')
}

async function remove(id: number) {
  await chat.deleteSession(id)
  show('会话已删除')
}

async function rename(id: number, currentTitle: string) {
  const input = await dialog.prompt('重命名会话', { value: currentTitle })
  if (input === null || !input.trim()) return
  await chat.renameSession(id, input)
  show('已重命名', 'success')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="backdrop" @click="emit('close')" />
    </Transition>
    <Transition name="drawer">
      <aside v-if="open" class="drawer">
        <header class="drawer-head">
          <div class="brand">
            <span class="brand-dot" />
            <span class="brand-name">MoFa</span>
          </div>
          <button class="icon-btn" aria-label="新对话" @click="newChat">
            <Icon name="plus" :size="19" />
          </button>
        </header>

        <div class="session-list">
          <button
            v-for="s in chat.sessions"
            :key="s.id"
            class="session-item"
            :class="{ active: s.id === chat.activeId }"
            @click="select(s.id!)"
          >
            <span class="session-title">{{ s.title }}</span>
            <span class="session-meta">
              {{ formatSessionTime(s.updatedAt) }}
              <span class="session-act" role="button" aria-label="重命名会话" @click.stop="rename(s.id!, s.title)">
                <Icon name="edit" :size="13" />
              </span>
              <span class="session-act" role="button" aria-label="删除会话" @click.stop="remove(s.id!)">
                <Icon name="trash" :size="13" />
              </span>
            </span>
          </button>
          <div v-if="!chat.sessions.length" class="empty-hint">还没有对话</div>
        </div>

        <footer class="drawer-foot">
          <button class="foot-btn" @click="router.push('/settings'); emit('close')">
            <Icon name="settings" :size="18" />
            <span>设置</span>
          </button>
        </footer>
      </aside>
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

.drawer {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  width: min(78vw, 320px);
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  border-right: 1px solid var(--border);
  z-index: 901;
  padding-top: var(--safe-top);
  padding-bottom: var(--safe-bottom);
}

.drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 14px 10px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
}

.brand-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 4px var(--accent-soft);
}

.brand-name {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.2px;
}

.session-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.session-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  text-align: left;
  padding: 9px 12px;
  border-radius: var(--radius);
  transition: background-color 0.15s ease;
}

.session-item.active {
  background: var(--accent-soft);
}

.session-item:not(.active):active {
  background: var(--bg-hover);
}

.session-title {
  font-size: 14px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.session-item.active .session-title {
  color: var(--accent);
  font-weight: 550;
}

.session-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--text-tertiary);
}

.session-act {
  display: inline-flex;
  padding: 3px;
  border-radius: 5px;
  opacity: 0.65;
}

.session-act:active {
  opacity: 1;
  background: var(--bg-active);
}

.empty-hint {
  padding: 30px 0;
  text-align: center;
  font-size: 13px;
  color: var(--text-tertiary);
}

.drawer-foot {
  padding: 10px 14px calc(12px);
  border-top: 1px solid var(--border);
}

.foot-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border-radius: var(--radius);
  font-size: 14px;
  color: var(--text-secondary);
}

.foot-btn:active {
  background: var(--bg-hover);
}

.drawer-enter-active,
.drawer-leave-active {
  transition: transform 0.28s cubic-bezier(0.32, 0.72, 0, 1);
}

.drawer-enter-from,
.drawer-leave-to {
  transform: translateX(-100%);
}
</style>
