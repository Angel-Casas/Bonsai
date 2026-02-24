import { describe, it, expect } from 'vitest'
import app from '../app'
import { signAccessToken } from '../services/jwt'

describe('Sync routes', () => {
  it('POST /sync/push rejects without auth', async () => {
    const res = await app.request('/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ops: [] }),
    })
    expect(res.status).toBe(401)
  })

  it('GET /sync/pull rejects without auth', async () => {
    const res = await app.request('/sync/pull')
    expect(res.status).toBe(401)
  })

  it('POST /sync/ack rejects without auth', async () => {
    const res = await app.request('/sync/ack', { method: 'POST' })
    expect(res.status).toBe(401)
  })
})
