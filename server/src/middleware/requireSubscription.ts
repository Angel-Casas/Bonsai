import type { MiddlewareHandler } from 'hono'
import { isSubscriptionActive } from '../services/subscription.js'

type SubscriptionLookup = (userId: string) => Promise<{ status: string; currentPeriodEnd: Date } | null>

export function createRequireSubscription(lookup: SubscriptionLookup): MiddlewareHandler {
  return async (c, next) => {
    const userId = c.get('userId')
    const sub = await lookup(userId)

    if (!sub || !isSubscriptionActive(sub)) {
      return c.json({ error: 'Active subscription required' }, 403)
    }

    await next()
  }
}
