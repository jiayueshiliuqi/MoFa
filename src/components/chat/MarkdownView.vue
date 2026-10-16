<script setup lang="ts">
import { computed } from 'vue'
import { renderMarkdown } from '@/lib/markdown'
import { saveTextFile, shareOrDownload, snippetName } from '@/lib/filesave'
import { isNative, openExternal } from '@/lib/platform'
import { useToast } from '@/composables/useToast'

const props = defineProps<{ content: string; streaming?: boolean }>()

const html = computed(() => renderMarkdown(props.content, props.streaming))

const { show } = useToast()

// 事件委托：处理代码块头部按钮（markdown 渲染出的 DOM 里不挂 Vue 事件）
async function onClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  const saveBtn = target.closest('.code-save') as HTMLElement | null
  if (saveBtn) {
    const code = decodeURIComponent(saveBtn.dataset.code ?? '')
    try {
      const file = saveTextFile(code, snippetName(saveBtn.dataset.lang ?? ''), 'text/plain')
    const how = await shareOrDownload(file)
    if (how !== 'cancelled') show(how === 'shared' ? '已打开系统分享，可选择保存位置' : '已开始下载', 'success')
    } catch {
      show('保存失败', 'error')
    }
    return
  }
  // 原生端外链统一走系统浏览器（WebView 不处理 target=_blank）
  const anchor = target.closest('a[href]') as HTMLAnchorElement | null
  if (anchor) {
    const href = anchor.getAttribute('href') ?? ''
    if (isNative && /^https?:\/\//.test(href)) {
      e.preventDefault()
      openExternal(href)
    }
    return
  }
  const btn = target.closest('.code-copy') as HTMLElement | null
  if (!btn) return
  const encoded = btn.dataset.code ?? ''
  const code = decodeURIComponent(encoded)
  navigator.clipboard
    .writeText(code)
    .then(() => {
      btn.textContent = '已复制'
      setTimeout(() => (btn.textContent = '复制'), 1600)
    })
    .catch(() => show('复制失败', 'error'))
}
</script>

<template>
  <!-- markdown-it 配置 html:false，仅渲染受限的 markdown 语法子集 -->
  <div class="md" @click="onClick" v-html="html" />
</template>
