import { Hono } from 'hono'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/connection'
import { subscriptions } from '../db/schema'
import { authMiddleware } from '../middleware/auth'
import { createInvoice } from '../services/btcpay'
import { PLAN_PRICES, type Plan } from '../services/subscription'

const subs = new Hono()

subs.use('/*', authMiddleware)

subs.post('/checkout', async (c) => {
  const { plan } = await c.req.json<{ plan: Plan }>()
  if (plan !== 'monthly' && plan !== 'yearly') {
    return c.json({ error: 'Invalid plan. Must be "monthly" or "yearly"' }, 400)
  }

  const userId = c.get('userId')
  const amount = PLAN_PRICES[plan]
  const APP_URL = process.env.APP_URL || 'http://localhost:5173'

  const invoice = await createInvoice({
    amount,
    currency: 'USD',
    orderId: `bonsai-${userId}-${Date.now()}`,
    redirectUrl: `${APP_URL}/subscription/success`,
    metadata: { userId, plan },
  })

  return c.json({ checkoutUrl: invoice.checkoutLink, invoiceId: invoice.id })
})

subs.get('/status', async (c) => {
  const userId = c.get('userId')
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, 'active')))
    .orderBy(desc(subscriptions.currentPeriodEnd))
    .limit(1)

  if (!sub || sub.currentPeriodEnd < new Date()) {
    return c.json({ active: false })
  }

  return c.json({
    active: true,
    plan: sub.plan,
    currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
  })
})

export default subs
