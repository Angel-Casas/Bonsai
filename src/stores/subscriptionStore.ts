import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useAuthStore } from './authStore'

const SYNC_SERVER_URL = import.meta.env.VITE_SYNC_SERVER_URL || 'http://localhost:3000'

interface SubscriptionStatus {
  active: boolean
  plan?: string
  currentPeriodEnd?: string
}

export const useSubscriptionStore = defineStore('subscription', () => {
  const status = ref<SubscriptionStatus>({ active: false })

  const isActive = computed(() => status.value.active)
  const plan = computed(() => status.value.plan ?? null)
  const periodEnd = computed(() => status.value.currentPeriodEnd ?? null)

  function setStatus(s: SubscriptionStatus) {
    status.value = s
  }

  function reset() {
    status.value = { active: false }
  }

  async function fetchStatus(): Promise<void> {
    const authStore = useAuthStore()
    if (!authStore.accessToken) return

    const res = await fetch(`${SYNC_SERVER_URL}/subscriptions/status`, {
      headers: { Authorization: `Bearer ${authStore.accessToken}` },
    })

    if (res.status === 401) {
      const refreshed = await authStore.refreshAccessToken()
      if (!refreshed) return
      const retry = await fetch(`${SYNC_SERVER_URL}/subscriptions/status`, {
        headers: { Authorization: `Bearer ${refreshed}` },
      })
      if (retry.ok) setStatus(await retry.json())
      return
    }

    if (res.ok) {
      setStatus(await res.json())
    }
  }

  async function startCheckout(planChoice: 'monthly' | 'yearly'): Promise<string> {
    const authStore = useAuthStore()
    if (!authStore.accessToken) throw new Error('Not authenticated')

    const res = await fetch(`${SYNC_SERVER_URL}/subscriptions/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body: JSON.stringify({ plan: planChoice }),
    })

    if (!res.ok) {
      const body = await res.json()
      throw new Error(body.error || 'Checkout failed')
    }

    const data = await res.json()
    return data.checkoutUrl
  }

  return {
    isActive,
    plan,
    periodEnd,
    setStatus,
    reset,
    fetchStatus,
    startCheckout,
  }
})
