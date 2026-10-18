import { reactive } from 'vue'
import type { DownloadProgress } from '@/services/update'

/**
 * 应用内更新的下载进度（模块级单例）。
 * useUpdate 负责驱动，UpdateProgress 组件负责展示；
 * 放在模块级是为了让设置页/首页共用同一份状态，不会同时弹出两个进度框。
 */
export interface UpdateProgressState {
  visible: boolean
  phase: 'downloading' | 'installing'
  version: string
  percent: number
  received: number
  total: number
}

const state = reactive<UpdateProgressState>({
  visible: false,
  phase: 'downloading',
  version: '',
  percent: 0,
  received: 0,
  total: 0,
})

export function useUpdateProgress(): UpdateProgressState {
  return state
}

export function showUpdateProgress(version: string) {
  state.version = version
  state.phase = 'downloading'
  state.percent = 0
  state.received = 0
  state.total = 0
  state.visible = true
}

export function applyUpdateProgress(p: DownloadProgress) {
  state.percent = Math.max(0, Math.min(100, Math.round(p.progress)))
  state.received = p.received
  state.total = p.total
}

export function setUpdatePhase(phase: 'downloading' | 'installing') {
  state.phase = phase
}

export function hideUpdateProgress() {
  state.visible = false
}
