import { describe, it, expect } from 'vitest'
import { signAccessToken, signRefreshToken, verifyAccessToken } from './jwt'

describe('JWT utilities', () => {
  it('signs and verifies an access token', async () => {
    const token = await signAccessToken({ userId: 'test-user-id', email: 'test@example.com' })
    expect(typeof token).toBe('string')

    const payload = await verifyAccessToken(token)
    expect(payload.userId).toBe('test-user-id')
    expect(payload.email).toBe('test@example.com')
  })

  it('signs a refresh token', async () => {
    const token = await signRefreshToken('test-user-id')
    expect(typeof token).toBe('string')
  })

  it('rejects expired tokens', async () => {
    const { SignJWT } = await import('jose')
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'test-secret-key-for-development-only')
    const token = await new SignJWT({ userId: 'test', email: 'test@test.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('0s')
      .sign(secret)

    await expect(verifyAccessToken(token)).rejects.toThrow()
  })
})
