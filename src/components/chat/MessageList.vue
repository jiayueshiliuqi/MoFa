<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { UiMessage } from '@/stores/chat'
import MessageItem from './MessageItem.vue'

const props = defineProps<{ messages: UiMessage[]; streaming: boolean }>()
const emit = defineEmits<{
  regenerate: [msg: UiMessage]
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

// ---- 缓动跟随：流式内容增长时，视口以每帧插值的方式滑向底部，而非瞬移 ----
let followRaf = 0

function stopFollow() {
  if (followRaf) {
    cancelAnimationFrame(followRaf)
    followRaf = 0
  }
}

function followFrame() {
  const el = listEl.value
  if (!el) {
    followRaf = 0
    return
  }
  const dist = el.scrollHeight - el.scrollTop - el.clientHeight
  // 距离突然拉大说明用户主动向上翻阅，停止跟随
  if (dist > el.clientHeight * 1.2 || dist < 1) {
    followRaf = 0
    return
  }
  el.scrollTop += dist * 0.22
  followRaf = requestAnimationFrame(followFrame)
}

function startFollow() {
  if (!followRaf) followRaf = requestAnimationFrame(followFrame)
}

// 用户手势期间暂停自动跟随：一旦开始拖动/滚轮就完全让位，
// 直到滚回底部附近才恢复跟随资格——否则缓动下拉会跟手指抢滚动条，表现为「拉不动」
let userScrolling = false
let gestureTimer: ReturnType<typeof setTimeout> | null = null

function pauseFollow() {
  userScrolling = true
  stopFollow()
  // 手势结束后重新判定：在底部轻轻滑一下不应永久停掉跟随
  if (gestureTimer) clearTimeout(gestureTimer)
  gestureTimer = setTimeout(() => {
    gestureTimer = null
    if (nearBottom()) userScrolling = false
  }, 400)
}

function onListScroll() {
  if (userScrolling && nearBottom()) userScrolling = false
}

// watch key 同时覆盖正文与思考流的增长
watch(
  () => props.messages.map((m) => `${m.content.length}:${m.reasoning?.length ?? 0}`).join(','),
  () => {
    if (userScrolling || !nearBottom()) return
    startFollow()
  },
)

// 切换会话 / 首次挂载：等 DOM 就绪后定位到底部（两个会话消息条数相同时长度 watcher 不会触发）
watch(
  () => props.messages,
  async () => {
    userScrolling = false
    await nextTick()
    listEl.value?.scrollTo({ top: listEl.value.scrollHeight })
  },
  { immediate: true },
)

onMounted(async () => {
  await nextTick()
  listEl.value?.scrollTo({ top: listEl.value.scrollHeight })
})

onUnmounted(() => {
  stopFollow()
  if (gestureTimer) clearTimeout(gestureTimer)
})
</script>

<template>
  <div ref="listEl" class="message-list" @touchmove.passive="pauseFollow" @wheel.passive="pauseFollow" @scroll="onListScroll">
    <div class="message-list-inner">
      <MessageItem
        v-for="(msg, i) in messages"
        :key="msg.id"
        :msg="msg"
        :is-last="i === messages.length - 1"
        :streaming="streaming"
        @regenerate="emit('regenerate', msg)"
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
