import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { users, magicLinks, sessions } from '../db/schema.js'
import { signAccessToken, signRefreshToken } from '../services/jwt.js'
import { sendMagicLinkEmail } from '../services/email.js'

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

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback'

// GET /auth/google — redirect to Google consent screen
auth.get('/google', (c) => {
  const authParams = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
  })
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${authParams}`)
})

// GET /auth/google/callback — handle Google OAuth callback
auth.get('/google/callback', async (c) => {
  const code = c.req.query('code')
  if (!code) {
    return c.json({ error: 'Missing authorization code' }, 400)
  }

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })

  const tokenData = await tokenRes.json() as { id_token?: string }
  if (!tokenData.id_token) {
    return c.json({ error: 'Failed to authenticate with Google' }, 401)
  }

  // Decode ID token to get user info
  const parts = tokenData.id_token.split('.')
  const payload = JSON.parse(atob(parts[1])) as { sub: string; email: string }

  // Find or create user
  let [user] = await db.select().from(users).where(eq(users.googleId, payload.sub)).limit(1)
  if (!user) {
    [user] = await db.select().from(users).where(eq(users.email, payload.email)).limit(1)
    if (user) {
      await db.update(users).set({ googleId: payload.sub }).where(eq(users.id, user.id))
    } else {
      [user] = await db.insert(users).values({ email: payload.email, googleId: payload.sub }).returning()
    }
  }

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id))

  const accessToken = await signAccessToken({ userId: user.id, email: user.email })
  const refreshToken = await signRefreshToken(user.id)

  const refreshHash = await hashToken(refreshToken)
  await db.insert(sessions).values({
    userId: user.id,
    tokenHash: refreshHash,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  })

  const APP_URL = process.env.APP_URL || 'http://localhost:5173'
  const redirectParams = new URLSearchParams({ accessToken, refreshToken })
  return c.redirect(`${APP_URL}/auth/callback?${redirectParams}`)
})

async function hashToken(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token)
  const hash = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export default auth
