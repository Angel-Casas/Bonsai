import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'landing',
      component: () => import('@/views/LandingView.vue'),
    },
    {
      path: '/conversations',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
    },
    {
      path: '/conversation/:id',
      name: 'conversation',
      component: () => import('@/views/ConversationView.vue'),
      props: true,
    },
    {
      path: '/auth/verify',
      name: 'auth-verify',
      component: () => import('@/views/AuthVerifyView.vue'),
    },
    {
      path: '/auth/callback',
      name: 'auth-callback',
      component: () => import('@/views/AuthCallbackView.vue'),
    },
    {
      path: '/subscription/success',
      name: 'subscription-success',
      component: () => import('@/views/SubscriptionSuccessView.vue'),
    },
  ],
})

export default router
