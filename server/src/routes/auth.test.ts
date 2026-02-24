import { describe, it, expect } from 'vitest'
import app from '../app'

describe('Auth routes', () => {
  it('POST /auth/magic-link rejects missing email', async () => {
    const res = await app.request('/auth/magic-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('POST /auth/magic-link rejects invalid email', async () => {
    const res = await app.request('/auth/magic-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /auth/verify rejects missing token', async () => {
    const res = await app.request('/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('POST /auth/refresh rejects missing refresh token', async () => {
    const res = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('GET /auth/google/callback rejects missing code', async () => {
    const res = await app.request('/auth/google/callback')
    expect(res.status).toBe(400)
  })
})
