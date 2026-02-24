import { Hono } from 'hono'
import { eq, and, gt, ne, desc } from 'drizzle-orm'
import { db } from '../db/connection'
import { syncOps, subscriptions } from '../db/schema'
import { authMiddleware } from '../middleware/auth'
import { createRequireSubscription } from '../middleware/requireSubscription'

const sync = new Hono()

sync.use('/*', authMiddleware)

const requireSub = createRequireSubscription(async (userId) => {
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, 'active')))
    .orderBy(desc(subscriptions.currentPeriodEnd))
    .limit(1)
  return sub ?? null
})

sync.use('/*', requireSub)

// POST /sync/push — receive encrypted ops from client
sync.post('/push', async (c) => {
  const userId = c.get('userId')
  const { ops } = await c.req.json<{
    ops: Array<{
      id: string
      clientId: string
      encryptedPayload: string // base64
      conversationId?: string
      createdAt: string
    }>
  }>()

  if (!ops || !Array.isArray(ops) || ops.length === 0) {
    return c.json({ error: 'ops array required' }, 400)
  }

  const values = ops.map((op) => ({
    id: op.id,
    userId,
    clientId: op.clientId,
    encryptedPayload: Buffer.from(op.encryptedPayload, 'base64'),
    conversationId: op.conversationId ?? null,
    createdAt: new Date(op.createdAt),
  }))

  await db.insert(syncOps).values(values).onConflictDoNothing()

  return c.json({ pushed: values.length })
})

// GET /sync/pull — get ops from other devices
sync.get('/pull', async (c) => {
  const userId = c.get('userId')
  const since = c.req.query('since') || '1970-01-01T00:00:00Z'
  const clientId = c.req.query('clientId') || ''
  const limit = Math.min(Number(c.req.query('limit')) || 100, 500)

  const conditions = [
    eq(syncOps.userId, userId),
    gt(syncOps.createdAt, new Date(since)),
  ]
  if (clientId) {
    conditions.push(ne(syncOps.clientId, clientId))
  }

  const ops = await db
    .select()
    .from(syncOps)
    .where(and(...conditions))
    .orderBy(syncOps.createdAt)
    .limit(limit)

  return c.json({
    ops: ops.map((op) => ({
      id: op.id,
      clientId: op.clientId,
      encryptedPayload: Buffer.from(op.encryptedPayload).toString('base64'),
      conversationId: op.conversationId,
      createdAt: op.createdAt.toISOString(),
    })),
  })
})

// POST /sync/ack — acknowledge received ops
sync.post('/ack', async (c) => {
  return c.json({ received: true })
})

export default sync
