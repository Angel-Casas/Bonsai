import { describe, it, expect } from 'vitest'
import { getPeriodEnd, isSubscriptionActive } from './subscription'

describe('Subscription service', () => {
  it('calculates monthly period end as 30 days', () => {
    const start = new Date('2026-02-24T00:00:00Z')
    const end = getPeriodEnd(start, 'monthly')
    expect(end.toISOString()).toBe('2026-03-26T00:00:00.000Z')
  })

  it('calculates yearly period end as 365 days', () => {
    const start = new Date('2026-02-24T00:00:00Z')
    const end = getPeriodEnd(start, 'yearly')
    expect(end.toISOString()).toBe('2027-02-24T00:00:00.000Z')
  })

  it('reports active subscription as active', () => {
    const sub = {
      status: 'active' as const,
      currentPeriodEnd: new Date(Date.now() + 86400000),
    }
    expect(isSubscriptionActive(sub)).toBe(true)
  })

  it('reports expired subscription as inactive', () => {
    const sub = {
      status: 'active' as const,
      currentPeriodEnd: new Date(Date.now() - 86400000),
    }
    expect(isSubscriptionActive(sub)).toBe(false)
  })

  it('reports cancelled subscription as inactive', () => {
    const sub = {
      status: 'cancelled' as const,
      currentPeriodEnd: new Date(Date.now() + 86400000),
    }
    expect(isSubscriptionActive(sub)).toBe(false)
  })
})
