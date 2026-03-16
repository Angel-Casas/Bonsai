import { Hono } from 'hono'
import { db } from '../db/connection.js'
import { subscriptions } from '../db/schema.js'
import { verifyWebhookSignature } from '../services/btcpay.js'
import { getPeriodEnd, type Plan } from '../services/subscription.js'

const webhooks = new Hono()

webhooks.post('/btcpay', async (c) => {
  const body = await c.req.text()
  const signature = c.req.header('BTCPay-Sig') || ''

  const valid = await verifyWebhookSignature(body, signature)
  if (!valid) {
    return c.json({ error: 'Invalid signature' }, 401)
  }

  const event = JSON.parse(body) as {
    type: string
    invoiceId: string
    metadata: { userId: string; plan: string }
  }

  if (event.type !== 'InvoiceSettled') {
    return c.json({ received: true })
  }

  const { userId, plan } = event.metadata
  const now = new Date()
  const periodEnd = getPeriodEnd(now, plan as Plan)

  await db.insert(subscriptions).values({
    userId,
    plan,
    status: 'active',
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    btcpayInvoiceId: event.invoiceId,
  })

  return c.json({ received: true })
})

export default webhooks
