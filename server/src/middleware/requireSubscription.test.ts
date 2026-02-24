import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createRequireSubscription } from './requireSubscription'

describe('requireSubscription middleware', () => {
  it('rejects when no active subscription found', async () => {
    const middleware = createRequireSubscription(async () => null)
    const app = new Hono()
    app.use('/*', async (c, next) => { c.set('userId', 'user-1'); await next() })
    app.use('/*', middleware)
    app.get('/test', (c) => c.json({ ok: true }))

    const res = await app.request('/test')
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toContain('subscription')
  })

  it('allows when active subscription exists', async () => {
    const middleware = createRequireSubscription(async () => ({
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 86400000),
    }))
    const app = new Hono()
    app.use('/*', async (c, next) => { c.set('userId', 'user-1'); await next() })
    app.use('/*', middleware)
    app.get('/test', (c) => c.json({ ok: true }))

    const res = await app.request('/test')
    expect(res.status).toBe(200)
  })

  it('rejects when subscription is expired', async () => {
    const middleware = createRequireSubscription(async () => ({
      status: 'active',
      currentPeriodEnd: new Date(Date.now() - 86400000),
    }))
    const app = new Hono()
    app.use('/*', async (c, next) => { c.set('userId', 'user-1'); await next() })
    app.use('/*', middleware)
    app.get('/test', (c) => c.json({ ok: true }))

    const res = await app.request('/test')
    expect(res.status).toBe(403)
  })

  it('rejects when subscription status is cancelled', async () => {
    const middleware = createRequireSubscription(async () => ({
      status: 'cancelled',
      currentPeriodEnd: new Date(Date.now() + 86400000),
    }))
    const app = new Hono()
    app.use('/*', async (c, next) => { c.set('userId', 'user-1'); await next() })
    app.use('/*', middleware)
    app.get('/test', (c) => c.json({ ok: true }))

    const res = await app.request('/test')
    expect(res.status).toBe(403)
  })

  it('passes userId to the lookup function', async () => {
    let receivedUserId: string | undefined
    const middleware = createRequireSubscription(async (userId) => {
      receivedUserId = userId
      return { status: 'active', currentPeriodEnd: new Date(Date.now() + 86400000) }
    })
    const app = new Hono()
    app.use('/*', async (c, next) => { c.set('userId', 'user-42'); await next() })
    app.use('/*', middleware)
    app.get('/test', (c) => c.json({ ok: true }))

    await app.request('/test')
    expect(receivedUserId).toBe('user-42')
  })
})
