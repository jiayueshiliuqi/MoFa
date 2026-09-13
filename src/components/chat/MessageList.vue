<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { UiMessage } from '@/stores/chat'
import MessageItem from './MessageItem.vue'

const props = defineProps<{ messages: UiMessage[]; streaming: boolean }>()
const emit = defineEmits<{
  regenerate: []
  delete: [msg: UiMessage]
  edit: [msg: UiMessage, content: string]
}>()

const listEl = ref<HTMLElement | null>(null)

/** 用户在底部附近时自动跟随滚动，翻阅历史时不打扰 */
function nearBottom(): boolean {
  const el = listEl.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < 160
}

watch(
  () => props.messages.map((m) => m.content.length).join(','),
  async () => {
    if (!nearBottom()) return
    await nextTick()
    listEl.value?.scrollTo({ top: listEl.value.scrollHeight })
  },
)

watch(
  () => props.messages.length,
  async () => {
    await nextTick()
    listEl.value?.scrollTo({ top: listEl.value.scrollHeight })
  },
)
</script>

<template>
  <div ref="listEl" class="message-list">
    <div class="message-list-inner">
      <MessageItem
        v-for="(msg, i) in messages"
        :key="msg.id"
        :msg="msg"
        :is-last="i === messages.length - 1"
        :streaming="streaming"
        @regenerate="emit('regenerate')"
        @delete="emit('delete', msg)"
        @edit="(content) => emit('edit', msg, content)"
      />
    </div>
  </div>
</template>

<style scoped>
.message-list {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

.message-list-inner {
  max-width: var(--content-max-w);
  margin: 0 auto;
  padding: 12px 16px 20px;
  display: flex;
  flex-direction: column;
}
</style>
