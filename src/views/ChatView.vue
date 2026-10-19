<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useChatStore } from '@/stores/chat'
import { useProvidersStore } from '@/stores/providers'
import type { MessageFile } from '@/db'
import { exportConversation } from '@/lib/export'
import Icon from '@/components/ui/Icon.vue'
import MessageList from '@/components/chat/MessageList.vue'
import Composer from '@/components/chat/Composer.vue'
import SessionsDrawer from '@/components/SessionsDrawer.vue'
import ModelSheet from '@/components/ModelSheet.vue'
import PromptSheet from '@/components/PromptSheet.vue'
import IosInstallHint from '@/components/IosInstallHint.vue'
import { useToast } from '@/composables/useToast'
import { useUpdate } from '@/composables/useUpdate'
import { isNative } from '@/lib/platform'

const router = useRouter()
const chat = useChatStore()
const providers = useProvidersStore()
const { show } = useToast()
const update = useUpdate()

const drawerOpen = ref(false)
const sheetOpen = ref(false)
const promptOpen = ref(false)
const composerRef = ref<InstanceType<typeof Composer> | null>(null)

/** 发送：未受理（未配置服务商等）时把草稿放回输入框，避免用户输入丢失 */
async function onSend(payload: { text: string; images?: string[]; files?: MessageFile[] }) {
  try {
    const accepted = await chat.sendMessage(payload)
    if (!accepted) composerRef.value?.restoreDraft(payload)
  } catch {
    // 写入失败（IndexedDB 异常等）同样要保留草稿
    composerRef.value?.restoreDraft(payload)
    show('发送失败，请重试', 'error')
  }
}

let updateTimer: ReturnType<typeof setTimeout> | null = null
onMounted(() => {
  chat.init()
  update.init()
  // 仅原生端需要应用内更新；网页版刷新即最新
  if (isNative) updateTimer = setTimeout(() => update.runCheck(true), 1800)
})
onUnmounted(() => {
  if (updateTimer) clearTimeout(updateTimer)
})

const title = computed(() => chat.activeConv?.title ?? 'MoFa')
const configured = computed(() => providers.selectedConfig !== null)
const hasPrompt = computed(() => !!chat.activeConv?.systemPrompt)

async function doExport() {
  const conv = chat.activeConv
  if (!conv || !chat.messages.length || chat.isStreaming) return
  try {
    const how = await exportConversation(conv, chat.messages.filter((m) => !m.error))
    // 取消不提示（与「存为文件」一致）
    if (how === 'downloaded') show('已导出 Markdown 文件', 'success')
  } catch {
    // 用户取消分享不算错误，其余情况提示
    show('导出失败', 'error')
  }
}
</script>

<template>
  <div class="chat-page">
    <header class="topbar">
      <button class="icon-btn" aria-label="打开会话列表" @click="drawerOpen = true">
        <Icon name="menu" :size="21" />
      </button>
      <div class="topbar-title">{{ title }}</div>
      <button
        class="icon-btn"
        :class="{ 'accent-on': hasPrompt }"
        aria-label="对话设定"
        @click="promptOpen = true"
      >
        <Icon name="wand" :size="20" />
      </button>
      <button
        v-if="chat.messages.length"
        class="icon-btn"
        aria-label="导出对话"
        @click="doExport"
      >
        <Icon name="download" :size="20" />
      </button>
      <button class="icon-btn" aria-label="设置" @click="router.push('/settings')">
        <Icon name="settings" :size="20" />
      </button>
    </header>

    <!-- 未配置模型时的引导 -->
    <div v-if="!configured" class="setup-banner" @click="router.push('/settings')">
      还没有配置模型服务，点击去添加服务商 →
    </div>

    <!-- iOS：引导添加到主屏幕 -->
    <IosInstallHint />

    <!-- 空状态 -->
    <div v-if="!chat.messages.length" class="empty-state">
      <img class="empty-logo" src="/icons/icon-192.png" alt="" width="64" height="64" />
      <div class="empty-title">开始新对话</div>
      <div class="empty-sub">配置好服务商后，在下方输入消息即可开始</div>
    </div>

    <MessageList
      v-else
      :messages="chat.messages"
      :streaming="chat.isStreaming"
      @regenerate="(m) => chat.regenerate(m)"
      @delete="(m) => chat.deleteMessage(m)"
      @edit="(m, c) => chat.editAndResend(m, c)"
    />

    <!-- 联网搜索进行中的状态条 -->
    <Transition name="fade">
      <div v-if="chat.searchStatus" class="search-status">
        <Icon name="search" :size="14" class="search-status-icon" />
        <span class="search-status-text">{{ chat.searchStatus }}</span>
      </div>
    </Transition>

    <Composer
      ref="composerRef"
      :streaming="chat.isStreaming"
      @send="onSend"
      @stop="chat.stop()"
      @pick-model="sheetOpen = true"
    />

    <SessionsDrawer :open="drawerOpen" @close="drawerOpen = false" />
    <ModelSheet :open="sheetOpen" @close="sheetOpen = false" />
    <PromptSheet :open="promptOpen" @close="promptOpen = false" />
  </div>
</template>

<style scoped>
.chat-page {
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 已设置助手设定时，魔棒图标点亮 */
.accent-on {
  color: var(--accent);
}

.setup-banner {
  flex-shrink: 0;
  margin: 10px 16px 0;
  padding: 10px 14px;
  border-radius: var(--radius);
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 13px;
  text-align: center;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 0 30px;
}

.empty-logo {
  flex-shrink: 0;
  width: 64px;
  height: 64px;
  margin-bottom: 6px;
  border-radius: 16px;
  /* 图标自带圆角与透明外边，这里只保证在深色背景上不糊边 */
  display: block;
}

.empty-title {
  font-size: 17px;
  font-weight: 650;
}

.empty-sub {
  font-size: 13.5px;
  color: var(--text-tertiary);
  text-align: center;
}

/* 联网搜索状态条 */
.search-status {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 16px 0;
  padding: 7px 12px;
  border-radius: var(--radius);
  background: var(--bg-input);
  color: var(--text-secondary);
  font-size: 12.5px;
}

.search-status-icon {
  flex-shrink: 0;
  color: var(--accent);
  animation: search-pulse 1.1s ease-in-out infinite;
}

.search-status-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes search-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
</style>
