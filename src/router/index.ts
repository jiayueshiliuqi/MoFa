import { createRouter, createWebHashHistory } from 'vue-router'

// 用 hash 模式：Capacitor WebView 从 file:// 加载时无需任何服务端配置
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'chat',
      component: () => import('@/views/ChatView.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/SettingsView.vue'),
    },
    {
      path: '/settings/provider/:id',
      name: 'provider-edit',
      component: () => import('@/views/ProviderEditView.vue'),
    },
    // 未知路径（旧链接、手输 hash）回首页，避免白屏
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

export default router
