<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { UiMessage } from '@/stores/chat'
import Icon from '@/components/ui/Icon.vue'
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
  // 只以「是否已到底」作为结束条件。不能再用「距离突然拉大」判断用户翻阅：
  // 长回答高速输出时内容本身就会一次长高很多，会被误判成手动滚动而永久停止跟随。
  if (dist < 1) {
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
let lastScrollTop = 0
/**
 * 列表是否停在底部。必须跨帧记：键盘弹起那一刻，浏览器还没把 scrollTop 夹回来
 * （实测差值会从 0 跳到 300 多），此时现算 nearBottom() 一定是 false。
 */
const atBottom = ref(true)
/** 上一次看到的可视区高度：用来识别「这次 scroll 是容器变高矮带出来的」 */
let prevClientHeight = 0

function pauseFollow() {
  userScrolling = true
  // 用户开始操作滚动：立刻放弃「钉底部」和进行中的「回到底部」动画
  atBottom.value = false
  stopFollow()
  stopJump()
  // 手势结束后重新判定：在底部轻轻滑一下不应永久停掉跟随
  if (gestureTimer) clearTimeout(gestureTimer)
  gestureTimer = setTimeout(() => {
    gestureTimer = null
    if (nearBottom()) userScrolling = false
  }, 400)
}

function onListScroll() {
  const el = listEl.value
  if (!el) return
  const top = el.scrollTop
  // 可视区高度刚变过（键盘弹起/收起、输入框长高）时，浏览器会顺手改 scrollTop。
  // 那不是用户滚动：既不能当成「用户上翻」，也不能用它覆盖 atBottom，
  // 否则紧接着的 resize 回调会以为自己不该贴底而直接跳过。
  const layoutDriven = el.clientHeight !== prevClientHeight
  if (!layoutDriven) {
    // 内容增长不会让 scrollTop 变小；只有用户向上翻（含拖动滚动条）才会。
    // 这样既不会把流式增长误判为手动滚动，也能覆盖滚轮/触摸之外的滚动条拖动。
    if (top < lastScrollTop - 2) {
      userScrolling = true
      stopFollow()
    } else if (nearBottom()) {
      userScrolling = false
    }
    atBottom.value = nearBottom()
  }
  lastScrollTop = top
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
    const el = listEl.value
    if (!el) return
    el.scrollTo({ top: el.scrollHeight })
    // 切会话是瞬移，不是用户向上翻：同步滚动位置，避免 scroll 事件被误判
    lastScrollTop = el.scrollTop
    atBottom.value = true
    prevClientHeight = el.clientHeight
  },
  { immediate: true },
)

onMounted(async () => {
  await nextTick()
  const el = listEl.value
  if (!el) return
  el.scrollTo({ top: el.scrollHeight })
  lastScrollTop = el.scrollTop
  atBottom.value = true
  prevClientHeight = el.clientHeight
})

/**
 * 键盘弹出 / 输入框长高会改变列表可视区高度（WebView 被 insets 压矮）。
 * 浏览器只会按锚点微调滚动位置、不会贴回底部——实测会差 60px 左右，
 * 最后一条消息就有半行被输入框压住。
 *
 * 做法：尺寸变化后短暂「钉住」底部（键盘动画期间高度会连续变，每帧都要跟一次），
 * 但只在原本就在底部时钉；用户一上手滚动就立刻放弃。
 */
const PIN_MS = 450
let resizeRaf = 0
let pinUntil = 0
const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onListResize) : null

function pinToBottomNow() {
  const el = listEl.value
  if (!el) return
  el.scrollTop = el.scrollHeight
  lastScrollTop = el.scrollTop
  atBottom.value = true
}

function pinFrame() {
  resizeRaf = 0
  const el = listEl.value
  if (!el || !atBottom.value || performance.now() > pinUntil) return
  pinToBottomNow()
  resizeRaf = requestAnimationFrame(pinFrame)
}

function onListResize() {
  const el = listEl.value
  if (!el) return
  prevClientHeight = el.clientHeight
  // 这里不能用 nearBottom() 现算：此刻浏览器还没夹 scrollTop，差值会虚高
  if (!atBottom.value) return
  userScrolling = false
  pinUntil = performance.now() + PIN_MS
  pinToBottomNow()
  if (!resizeRaf) resizeRaf = requestAnimationFrame(pinFrame)
}

if (ro) {
  onMounted(() => {
    if (listEl.value) ro.observe(listEl.value)
  })
}

/**
 * 悬浮的「回到底部」按钮（往上翻历史后出现，跟 DeepSeek 一样）。
 * 不用原生 scrollTo({behavior:'smooth'})：部分 WebView 会忽略或停在半路，
 * 自己算缓动还能在流式输出时跟着长高的内容走。
 */
let jumpRaf = 0
function stopJump() {
  if (jumpRaf) {
    cancelAnimationFrame(jumpRaf)
    jumpRaf = 0
  }
}

function scrollToBottom() {
  const el = listEl.value
  if (!el) return
  // 复位「用户上翻」标记，滚到底之后自动跟随才能恢复
  userScrolling = false
  stopFollow()
  stopJump()
  const start = el.scrollTop
  const t0 = performance.now()
  const dur = 320
  const step = () => {
    const e = listEl.value
    if (!e) {
      jumpRaf = 0
      return
    }
    const t = Math.min(1, (performance.now() - t0) / dur)
    const k = 1 - Math.pow(1 - t, 3) // easeOutCubic
    const max = e.scrollHeight - e.clientHeight
    e.scrollTop = start + (max - start) * k
    if (t < 1) {
      jumpRaf = requestAnimationFrame(step)
    } else {
      jumpRaf = 0
      // 收尾对齐一次，避免小数像素造成的几十 px 误差
      pinToBottomNow()
    }
  }
  jumpRaf = requestAnimationFrame(step)
}

onUnmounted(() => {
  stopFollow()
  stopJump()
  if (gestureTimer) clearTimeout(gestureTimer)
  ro?.disconnect()
  if (resizeRaf) cancelAnimationFrame(resizeRaf)
})
</script>

<template>
  <div class="message-list-wrap">
    <div
      ref="listEl"
      class="message-list"
      @touchmove.passive="pauseFollow"
      @wheel.passive="pauseFollow"
      @scroll="onListScroll"
    >
      <div class="message-list-inner">
        <MessageItem
          v-for="(msg, i) in messages"
          :key="msg.uiKey ?? msg.id"
          :msg="msg"
          :is-last="i === messages.length - 1"
          :streaming="streaming"
          @regenerate="emit('regenerate', msg)"
          @delete="emit('delete', msg)"
          @edit="(content) => emit('edit', msg, content)"
        />
      </div>
    </div>

    <!-- 往上翻历史后出现：点一下回到底部 -->
    <Transition name="fade">
      <button v-if="!atBottom" class="scroll-bottom" aria-label="回到底部" @click="scrollToBottom">
        <Icon name="down" :size="18" />
      </button>
    </Transition>
  </div>
</template>

<style scoped>
.message-list-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.message-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

.scroll-bottom {
  position: absolute;
  right: 14px;
  bottom: 10px;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  box-shadow: var(--shadow-md);
}

.scroll-bottom:active {
  background: var(--bg-hover);
  color: var(--text);
}

.message-list-inner {
  max-width: var(--content-max-w);
  margin: 0 auto;
  padding: 12px 16px 20px;
  display: flex;
  flex-direction: column;
}
</style>
