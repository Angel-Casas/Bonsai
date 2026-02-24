import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../db/connection'
import { users, magicLinks, sessions } from '../db/schema'
import { signAccessToken, signRefreshToken } from '../services/jwt'
import { sendMagicLinkEmail } from '../services/email'

const auth = new Hono()

auth.post('/magic-link', async (c) => {
  const { email } = await c.req.json<{ email: string }>()
  if (!email || !email.includes('@')) {
    return c.json({ error: 'Valid email required' }, 400)
  }

  let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  if (!user) {
    [user] = await db.insert(users).values({ email }).returning()
  }

  const token = crypto.randomUUID()
  const tokenHash = await hashToken(token)
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000)

  await db.insert(magicLinks).values({ userId: user.id, tokenHash, expiresAt })
  await sendMagicLinkEmail(email, token)

  return c.json({ message: 'Magic link sent' })
})

auth.post('/verify', async (c) => {
  const { token } = await c.req.json<{ token: string }>()
  if (!token) {
    return c.json({ error: 'Token required' }, 400)
  }

  const tokenHash = await hashToken(token)
  const [link] = await db.select().from(magicLinks).where(eq(magicLinks.tokenHash, tokenHash)).limit(1)

  if (!link || link.usedAt || link.expiresAt < new Date()) {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }

  await db.update(magicLinks).set({ usedAt: new Date() }).where(eq(magicLinks.id, link.id))
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, link.userId))

  const [user] = await db.select().from(users).where(eq(users.id, link.userId)).limit(1)

  const accessToken = await signAccessToken({ userId: user.id, email: user.email })
  const refreshToken = await signRefreshToken(user.id)

  const refreshHash = await hashToken(refreshToken)
  await db.insert(sessions).values({
    userId: user.id,
    tokenHash: refreshHash,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  })

  return c.json({ accessToken, refreshToken, user: { id: user.id, email: user.email } })
})

auth.post('/refresh', async (c) => {
  const { refreshToken } = await c.req.json<{ refreshToken: string }>()
  if (!refreshToken) {
    return c.json({ error: 'Refresh token required' }, 400)
  }

  const tokenHash = await hashToken(refreshToken)
  const [session] = await db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1)

  if (!session || session.expiresAt < new Date()) {
    return c.json({ error: 'Invalid or expired session' }, 401)
  }

  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1)
  if (!user) {
    return c.json({ error: 'User not found' }, 401)
  }

  const accessToken = await signAccessToken({ userId: user.id, email: user.email })
  return c.json({ accessToken })
})

async function hashToken(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token)
  const hash = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export default auth
