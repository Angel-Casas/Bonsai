import { describe, it, expect } from 'vitest'
import app from '../app'
import { signAccessToken } from '../services/jwt'

describe('Subscription routes', () => {
  it('POST /subscriptions/checkout rejects without auth', async () => {
    const res = await app.request('/subscriptions/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'monthly' }),
    })
    expect(res.status).toBe(401)
  })

  it('POST /subscriptions/checkout rejects invalid plan', async () => {
    const token = await signAccessToken({ userId: 'user-1', email: 'test@test.com' })
    const res = await app.request('/subscriptions/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ plan: 'invalid' }),
    })
    expect(res.status).toBe(400)
  })

  it('GET /subscriptions/status rejects without auth', async () => {
    const res = await app.request('/subscriptions/status')
    expect(res.status).toBe(401)
  })
})
