<script setup lang="ts">
import { computed } from 'vue'
import { renderMarkdown } from '@/lib/markdown'
import { useToast } from '@/composables/useToast'

const props = defineProps<{ content: string; streaming?: boolean }>()

const html = computed(() => renderMarkdown(props.content, props.streaming))

const { show } = useToast()

// 事件委托：处理代码块复制按钮（markdown 渲染出的 DOM 里不挂 Vue 事件）
function onClick(e: MouseEvent) {
  const btn = (e.target as HTMLElement).closest('.code-copy') as HTMLElement | null
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
