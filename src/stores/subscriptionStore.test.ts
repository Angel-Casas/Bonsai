import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSubscriptionStore } from './subscriptionStore'

describe('subscriptionStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts with no active subscription', () => {
    const store = useSubscriptionStore()
    expect(store.isActive).toBe(false)
    expect(store.plan).toBeNull()
  })

  it('sets subscription status', () => {
    const store = useSubscriptionStore()
    store.setStatus({
      active: true,
      plan: 'monthly',
      currentPeriodEnd: '2026-03-24T00:00:00Z',
    })
    expect(store.isActive).toBe(true)
    expect(store.plan).toBe('monthly')
  })

  it('clears subscription on reset', () => {
    const store = useSubscriptionStore()
    store.setStatus({ active: true, plan: 'yearly', currentPeriodEnd: '2027-02-24T00:00:00Z' })
    store.reset()
    expect(store.isActive).toBe(false)
  })
})
