import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { authMiddleware } from './auth'
import { signAccessToken } from '../services/jwt'

describe('Auth middleware', () => {
  const app = new Hono()
  app.use('/protected/*', authMiddleware)
  app.get('/protected/test', (c) => c.json({ userId: c.get('userId') }))

  it('rejects requests without Authorization header', async () => {
    const res = await app.request('/protected/test')
    expect(res.status).toBe(401)
  })

  it('rejects invalid tokens', async () => {
    const res = await app.request('/protected/test', {
      headers: { Authorization: 'Bearer invalid-token' },
    })
    expect(res.status).toBe(401)
  })

  it('allows valid tokens and sets userId', async () => {
    const token = await signAccessToken({ userId: 'user-123', email: 'test@test.com' })
    const res = await app.request('/protected/test', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.userId).toBe('user-123')
  })
})
