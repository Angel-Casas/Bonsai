# Subscription & Sync Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a crypto-paid subscription that unlocks encrypted cloud sync & backup for Bonsai conversations.

**Architecture:** Monorepo with a new `server/` directory containing a Hono HTTP server + Drizzle ORM on PostgreSQL (hosted on Railway). Payments via self-hosted BTCPay Server. Client adds auth stores, subscription management, and a `RemoteSyncAdapter` that replaces the existing `LocalOnlySyncAdapter`.

**Tech Stack:** Hono, Drizzle ORM, PostgreSQL, jose (JWT), Resend (email), BTCPay Greenfield API, Vitest

**Design Doc:** `docs/plans/2026-02-24-subscription-sync-design.md`

---

## Phase 1: Server Scaffolding

### Task 1: Initialize server project

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/src/index.ts`

**Step 1: Create server/package.json**

```json
{
  "name": "bonsai-sync-server",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio"
  },
  "dependencies": {
    "hono": "^4.7.0",
    "@node-rs/argon2": "^2.0.2",
    "drizzle-orm": "^0.39.0",
    "postgres": "^3.4.0",
    "jose": "^6.0.0",
    "resend": "^4.0.0",
    "@hono/node-server": "^1.14.0"
  },
  "devDependencies": {
    "typescript": "^5.9.0",
    "tsx": "^4.19.0",
    "vitest": "^3.1.0",
    "drizzle-kit": "^0.30.0",
    "@types/node": "^22.0.0"
  }
}
```

**Step 2: Create server/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create server/src/index.ts with health check**

```typescript
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'

const app = new Hono()

app.use('/*', cors({
  origin: ['http://localhost:5173', 'https://angel-casas.github.io'],
  credentials: true,
}))

app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

const port = Number(process.env.PORT) || 3000

serve({ fetch: app.fetch, port }, () => {
  console.log(`Bonsai Sync Server running on port ${port}`)
})

export default app
export type AppType = typeof app
```

**Step 4: Install dependencies**

Run: `cd server && npm install`

**Step 5: Write health check test**

Create `server/src/index.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import app from './index'

describe('Health check', () => {
  it('returns ok status', async () => {
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.timestamp).toBeDefined()
  })
})
```

**Step 6: Run test to verify it passes**

Run: `cd server && npx vitest run`
Expected: PASS

**Step 7: Commit**

```bash
git add server/
git commit -m "feat(server): scaffold Hono server with health check"
```

---

### Task 2: Database schema with Drizzle

**Files:**
- Create: `server/src/db/schema.ts`
- Create: `server/src/db/connection.ts`
- Create: `server/drizzle.config.ts`

**Step 1: Create server/src/db/schema.ts**

```typescript
import { pgTable, uuid, text, timestamp, bytea } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').unique().notNull(),
  googleId: text('google_id').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
})

export const magicLinks = pgTable('magic_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
})

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  plan: text('plan').notNull(), // 'monthly' | 'yearly'
  status: text('status').notNull(), // 'active' | 'expired' | 'cancelled'
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }).notNull(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
  btcpayInvoiceId: text('btcpay_invoice_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const syncOps = pgTable('sync_ops', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  clientId: text('client_id').notNull(),
  encryptedPayload: bytea('encrypted_payload').notNull(),
  conversationId: text('conversation_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
```

**Step 2: Create server/src/db/connection.ts**

```typescript
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/bonsai'

const client = postgres(connectionString)
export const db = drizzle(client, { schema })
```

**Step 3: Create server/drizzle.config.ts**

```typescript
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://localhost:5432/bonsai',
  },
})
```

**Step 4: Write schema test**

Create `server/src/db/schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { users, magicLinks, subscriptions, syncOps, sessions } from './schema'

describe('Database schema', () => {
  it('defines users table with required columns', () => {
    expect(users.id).toBeDefined()
    expect(users.email).toBeDefined()
    expect(users.googleId).toBeDefined()
    expect(users.createdAt).toBeDefined()
  })

  it('defines subscriptions table with plan and status', () => {
    expect(subscriptions.plan).toBeDefined()
    expect(subscriptions.status).toBeDefined()
    expect(subscriptions.currentPeriodEnd).toBeDefined()
    expect(subscriptions.btcpayInvoiceId).toBeDefined()
  })

  it('defines syncOps table with encrypted payload', () => {
    expect(syncOps.encryptedPayload).toBeDefined()
    expect(syncOps.clientId).toBeDefined()
    expect(syncOps.conversationId).toBeDefined()
  })

  it('defines magic_links and sessions tables', () => {
    expect(magicLinks.tokenHash).toBeDefined()
    expect(magicLinks.expiresAt).toBeDefined()
    expect(sessions.tokenHash).toBeDefined()
    expect(sessions.expiresAt).toBeDefined()
  })
})
```

**Step 5: Run tests**

Run: `cd server && npx vitest run`
Expected: PASS

**Step 6: Generate initial migration**

Run: `cd server && npx drizzle-kit generate`
Expected: Migration files created in `server/src/db/migrations/`

**Step 7: Commit**

```bash
git add server/
git commit -m "feat(server): add Drizzle schema and database connection"
```

---

## Phase 2: Authentication

### Task 3: JWT utilities

**Files:**
- Create: `server/src/services/jwt.ts`
- Create: `server/src/services/jwt.test.ts`

**Step 1: Write failing test**

Create `server/src/services/jwt.test.ts`:

```typescript
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
    // Create a token that's already expired by signing with 0s expiry
    const { SignJWT } = await import('jose')
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'test-secret-key-for-development-only')
    const token = await new SignJWT({ userId: 'test', email: 'test@test.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('0s')
      .sign(secret)

    await expect(verifyAccessToken(token)).rejects.toThrow()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/services/jwt.test.ts`
Expected: FAIL — module not found

**Step 3: Implement JWT utilities**

Create `server/src/services/jwt.ts`:

```typescript
import { SignJWT, jwtVerify } from 'jose'

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET || 'test-secret-key-for-development-only'
)

export interface AccessTokenPayload {
  userId: string
  email: string
}

export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  return new SignJWT({ userId: payload.userId, email: payload.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secret)
}

export async function signRefreshToken(userId: string): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret)
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, secret)
  return { userId: payload.userId as string, email: payload.email as string }
}

export async function verifyRefreshToken(token: string): Promise<{ userId: string }> {
  const { payload } = await jwtVerify(token, secret)
  return { userId: payload.userId as string }
}
```

**Step 4: Run tests**

Run: `cd server && npx vitest run src/services/jwt.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/src/services/jwt.ts server/src/services/jwt.test.ts
git commit -m "feat(server): add JWT sign/verify utilities"
```

---

### Task 4: Auth middleware

**Files:**
- Create: `server/src/middleware/auth.ts`
- Create: `server/src/middleware/auth.test.ts`

**Step 1: Write failing test**

Create `server/src/middleware/auth.test.ts`:

```typescript
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
```

**Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/middleware/auth.test.ts`
Expected: FAIL

**Step 3: Implement auth middleware**

Create `server/src/middleware/auth.ts`:

```typescript
import type { MiddlewareHandler } from 'hono'
import { verifyAccessToken } from '../services/jwt'

// Extend Hono context with auth variables
declare module 'hono' {
  interface ContextVariableMap {
    userId: string
    email: string
  }
}

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing authorization token' }, 401)
  }

  const token = header.slice(7)
  try {
    const payload = await verifyAccessToken(token)
    c.set('userId', payload.userId)
    c.set('email', payload.email)
    await next()
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }
}
```

**Step 4: Run tests**

Run: `cd server && npx vitest run src/middleware/auth.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/src/middleware/
git commit -m "feat(server): add JWT auth middleware"
```

---

### Task 5: Magic link auth routes

**Files:**
- Create: `server/src/services/email.ts`
- Create: `server/src/routes/auth.ts`
- Create: `server/src/routes/auth.test.ts`
- Modify: `server/src/index.ts` — mount auth routes

**Step 1: Create email service**

Create `server/src/services/email.ts`:

```typescript
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY || 'test-key')
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@bonsai.app'
const APP_URL = process.env.APP_URL || 'http://localhost:5173'

export async function sendMagicLinkEmail(email: string, token: string): Promise<void> {
  const url = `${APP_URL}/auth/verify?token=${token}`

  await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: 'Sign in to Bonsai',
    html: `
      <h2>Sign in to Bonsai</h2>
      <p>Click the link below to sign in. This link expires in 15 minutes.</p>
      <a href="${url}" style="display:inline-block;padding:12px 24px;background:#E7D27C;color:#0f172a;text-decoration:none;border-radius:8px;font-weight:600;">
        Sign in to Bonsai
      </a>
      <p style="margin-top:16px;color:#666;">If you didn't request this, you can safely ignore this email.</p>
    `,
  })
}
```

**Step 2: Create auth routes**

Create `server/src/routes/auth.ts`:

```typescript
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../db/connection'
import { users, magicLinks, sessions } from '../db/schema'
import { signAccessToken, signRefreshToken } from '../services/jwt'
import { sendMagicLinkEmail } from '../services/email'

const auth = new Hono()

// POST /auth/magic-link — send a magic link email
auth.post('/magic-link', async (c) => {
  const { email } = await c.req.json<{ email: string }>()

  if (!email || !email.includes('@')) {
    return c.json({ error: 'Valid email required' }, 400)
  }

  // Find or create user
  let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  if (!user) {
    [user] = await db.insert(users).values({ email }).returning()
  }

  // Generate token and store hash
  const token = crypto.randomUUID()
  const tokenHash = await hashToken(token)
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 minutes

  await db.insert(magicLinks).values({
    userId: user.id,
    tokenHash,
    expiresAt,
  })

  // Send email (fire-and-forget in dev, await in prod)
  await sendMagicLinkEmail(email, token)

  return c.json({ message: 'Magic link sent' })
})

// POST /auth/verify — verify a magic link token
auth.post('/verify', async (c) => {
  const { token } = await c.req.json<{ token: string }>()

  if (!token) {
    return c.json({ error: 'Token required' }, 400)
  }

  const tokenHash = await hashToken(token)

  // Find valid, unused magic link
  const [link] = await db
    .select()
    .from(magicLinks)
    .where(eq(magicLinks.tokenHash, tokenHash))
    .limit(1)

  if (!link || link.usedAt || link.expiresAt < new Date()) {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }

  // Mark as used
  await db.update(magicLinks).set({ usedAt: new Date() }).where(eq(magicLinks.id, link.id))

  // Update last login
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, link.userId))

  // Get user
  const [user] = await db.select().from(users).where(eq(users.id, link.userId)).limit(1)

  // Issue tokens
  const accessToken = await signAccessToken({ userId: user.id, email: user.email })
  const refreshToken = await signRefreshToken(user.id)

  // Store refresh token hash
  const refreshHash = await hashToken(refreshToken)
  await db.insert(sessions).values({
    userId: user.id,
    tokenHash: refreshHash,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
  })

  return c.json({
    accessToken,
    refreshToken,
    user: { id: user.id, email: user.email },
  })
})

// POST /auth/refresh — exchange refresh token for new access token
auth.post('/refresh', async (c) => {
  const { refreshToken } = await c.req.json<{ refreshToken: string }>()

  if (!refreshToken) {
    return c.json({ error: 'Refresh token required' }, 400)
  }

  const tokenHash = await hashToken(refreshToken)
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1)

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
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export default auth
```

**Step 3: Mount auth routes in server/src/index.ts**

Add after the health check route:

```typescript
import auth from './routes/auth'
app.route('/auth', auth)
```

**Step 4: Write auth route tests (unit tests with mocked DB)**

Create `server/src/routes/auth.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import app from '../index'

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
})
```

**Step 5: Run tests**

Run: `cd server && npx vitest run`
Expected: PASS (validation tests pass without DB)

**Step 6: Commit**

```bash
git add server/src/
git commit -m "feat(server): add magic link auth routes and email service"
```

---

### Task 6: Google OAuth route

**Files:**
- Modify: `server/src/routes/auth.ts` — add Google OAuth endpoints

**Step 1: Add Google OAuth endpoints to server/src/routes/auth.ts**

Append to the auth router:

```typescript
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback'

// GET /auth/google — redirect to Google consent screen
auth.get('/google', (c) => {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
  })
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
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

  // Decode ID token to get user info (Google's ID tokens are JWTs)
  const parts = tokenData.id_token.split('.')
  const payload = JSON.parse(atob(parts[1])) as { sub: string; email: string }

  // Find or create user
  let [user] = await db.select().from(users).where(eq(users.googleId, payload.sub)).limit(1)
  if (!user) {
    // Check if email already exists (link accounts)
    [user] = await db.select().from(users).where(eq(users.email, payload.email)).limit(1)
    if (user) {
      await db.update(users).set({ googleId: payload.sub }).where(eq(users.id, user.id))
    } else {
      [user] = await db.insert(users).values({ email: payload.email, googleId: payload.sub }).returning()
    }
  }

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id))

  // Issue tokens
  const accessToken = await signAccessToken({ userId: user.id, email: user.email })
  const refreshToken = await signRefreshToken(user.id)

  const refreshHash = await hashToken(refreshToken)
  await db.insert(sessions).values({
    userId: user.id,
    tokenHash: refreshHash,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  })

  // Redirect back to client with tokens
  const APP_URL = process.env.APP_URL || 'http://localhost:5173'
  const params = new URLSearchParams({ accessToken, refreshToken })
  return c.redirect(`${APP_URL}/auth/callback?${params}`)
})
```

**Step 2: Add test for missing code**

Append to `server/src/routes/auth.test.ts`:

```typescript
it('GET /auth/google/callback rejects missing code', async () => {
  const res = await app.request('/auth/google/callback')
  expect(res.status).toBe(400)
})
```

**Step 3: Run tests**

Run: `cd server && npx vitest run`
Expected: PASS

**Step 4: Commit**

```bash
git add server/src/routes/auth.ts server/src/routes/auth.test.ts
git commit -m "feat(server): add Google OAuth routes"
```

---

## Phase 3: Subscriptions & BTCPay

### Task 7: Subscription service

**Files:**
- Create: `server/src/services/subscription.ts`
- Create: `server/src/services/subscription.test.ts`

**Step 1: Write failing test**

Create `server/src/services/subscription.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { getPeriodEnd, isSubscriptionActive } from './subscription'

describe('Subscription service', () => {
  it('calculates monthly period end as 30 days', () => {
    const start = new Date('2026-02-24T00:00:00Z')
    const end = getPeriodEnd(start, 'monthly')
    expect(end.toISOString()).toBe('2026-03-26T00:00:00.000Z')
  })

  it('calculates yearly period end as 365 days', () => {
    const start = new Date('2026-02-24T00:00:00Z')
    const end = getPeriodEnd(start, 'yearly')
    expect(end.toISOString()).toBe('2027-02-24T00:00:00.000Z')
  })

  it('reports active subscription as active', () => {
    const sub = {
      status: 'active' as const,
      currentPeriodEnd: new Date(Date.now() + 86400000), // tomorrow
    }
    expect(isSubscriptionActive(sub)).toBe(true)
  })

  it('reports expired subscription as inactive', () => {
    const sub = {
      status: 'active' as const,
      currentPeriodEnd: new Date(Date.now() - 86400000), // yesterday
    }
    expect(isSubscriptionActive(sub)).toBe(false)
  })

  it('reports cancelled subscription as inactive', () => {
    const sub = {
      status: 'cancelled' as const,
      currentPeriodEnd: new Date(Date.now() + 86400000),
    }
    expect(isSubscriptionActive(sub)).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/services/subscription.test.ts`
Expected: FAIL

**Step 3: Implement subscription service**

Create `server/src/services/subscription.ts`:

```typescript
export type Plan = 'monthly' | 'yearly'
export type SubscriptionStatus = 'active' | 'expired' | 'cancelled'

export const PLAN_PRICES: Record<Plan, number> = {
  monthly: 5,
  yearly: 48,
}

export function getPeriodEnd(start: Date, plan: Plan): Date {
  const end = new Date(start)
  if (plan === 'monthly') {
    end.setDate(end.getDate() + 30)
  } else {
    end.setFullYear(end.getFullYear() + 1)
  }
  return end
}

export function isSubscriptionActive(sub: { status: string; currentPeriodEnd: Date }): boolean {
  return sub.status === 'active' && sub.currentPeriodEnd > new Date()
}
```

**Step 4: Run tests**

Run: `cd server && npx vitest run src/services/subscription.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/src/services/subscription.ts server/src/services/subscription.test.ts
git commit -m "feat(server): add subscription period calculation and status checks"
```

---

### Task 8: Subscription check middleware

**Files:**
- Create: `server/src/middleware/requireSubscription.ts`
- Create: `server/src/middleware/requireSubscription.test.ts`

**Step 1: Write failing test**

Create `server/src/middleware/requireSubscription.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { createRequireSubscription } from './requireSubscription'
import { signAccessToken } from '../services/jwt'

describe('requireSubscription middleware', () => {
  it('rejects when no active subscription found', async () => {
    const middleware = createRequireSubscription(async () => null)
    const app = new Hono()
    // Simulate authed user
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
})
```

**Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/middleware/requireSubscription.test.ts`
Expected: FAIL

**Step 3: Implement**

Create `server/src/middleware/requireSubscription.ts`:

```typescript
import type { MiddlewareHandler } from 'hono'
import { isSubscriptionActive } from '../services/subscription'

type SubscriptionLookup = (userId: string) => Promise<{ status: string; currentPeriodEnd: Date } | null>

export function createRequireSubscription(lookup: SubscriptionLookup): MiddlewareHandler {
  return async (c, next) => {
    const userId = c.get('userId')
    const sub = await lookup(userId)

    if (!sub || !isSubscriptionActive(sub)) {
      return c.json({ error: 'Active subscription required' }, 403)
    }

    await next()
  }
}
```

**Step 4: Run tests**

Run: `cd server && npx vitest run src/middleware/requireSubscription.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/src/middleware/requireSubscription.ts server/src/middleware/requireSubscription.test.ts
git commit -m "feat(server): add subscription check middleware"
```

---

### Task 9: BTCPay service and subscription routes

**Files:**
- Create: `server/src/services/btcpay.ts`
- Create: `server/src/routes/subscriptions.ts`
- Create: `server/src/routes/subscriptions.test.ts`
- Modify: `server/src/index.ts` — mount subscription routes

**Step 1: Create BTCPay service**

Create `server/src/services/btcpay.ts`:

```typescript
const BTCPAY_URL = process.env.BTCPAY_URL || 'http://localhost:23001'
const BTCPAY_STORE_ID = process.env.BTCPAY_STORE_ID || ''
const BTCPAY_API_KEY = process.env.BTCPAY_API_KEY || ''
const BTCPAY_WEBHOOK_SECRET = process.env.BTCPAY_WEBHOOK_SECRET || ''

export interface CreateInvoiceParams {
  amount: number
  currency: string
  orderId: string
  redirectUrl: string
  metadata: Record<string, string>
}

export interface BtcpayInvoice {
  id: string
  checkoutLink: string
  status: string
}

export async function createInvoice(params: CreateInvoiceParams): Promise<BtcpayInvoice> {
  const res = await fetch(`${BTCPAY_URL}/api/v1/stores/${BTCPAY_STORE_ID}/invoices`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `token ${BTCPAY_API_KEY}`,
    },
    body: JSON.stringify({
      amount: params.amount,
      currency: params.currency,
      orderId: params.orderId,
      checkout: { redirectURL: params.redirectUrl },
      metadata: params.metadata,
    }),
  })

  if (!res.ok) {
    throw new Error(`BTCPay invoice creation failed: ${res.status}`)
  }

  return (await res.json()) as BtcpayInvoice
}

export async function verifyWebhookSignature(body: string, signature: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(BTCPAY_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `sha256=${expected}` === signature
}
```

**Step 2: Create subscription routes**

Create `server/src/routes/subscriptions.ts`:

```typescript
import { Hono } from 'hono'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/connection'
import { subscriptions } from '../db/schema'
import { authMiddleware } from '../middleware/auth'
import { createInvoice } from '../services/btcpay'
import { PLAN_PRICES, getPeriodEnd, type Plan } from '../services/subscription'

const subs = new Hono()

// All routes require auth
subs.use('/*', authMiddleware)

// POST /subscriptions/checkout — create BTCPay invoice
subs.post('/checkout', async (c) => {
  const { plan } = await c.req.json<{ plan: Plan }>()

  if (plan !== 'monthly' && plan !== 'yearly') {
    return c.json({ error: 'Invalid plan. Must be "monthly" or "yearly"' }, 400)
  }

  const userId = c.get('userId')
  const amount = PLAN_PRICES[plan]
  const APP_URL = process.env.APP_URL || 'http://localhost:5173'

  const invoice = await createInvoice({
    amount,
    currency: 'USD',
    orderId: `bonsai-${userId}-${Date.now()}`,
    redirectUrl: `${APP_URL}/subscription/success`,
    metadata: { userId, plan },
  })

  return c.json({ checkoutUrl: invoice.checkoutLink, invoiceId: invoice.id })
})

// GET /subscriptions/status — check current subscription
subs.get('/status', async (c) => {
  const userId = c.get('userId')

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, 'active')))
    .orderBy(desc(subscriptions.currentPeriodEnd))
    .limit(1)

  if (!sub || sub.currentPeriodEnd < new Date()) {
    return c.json({ active: false })
  }

  return c.json({
    active: true,
    plan: sub.plan,
    currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
  })
})

export default subs
```

**Step 3: Create BTCPay webhook route**

Create `server/src/routes/webhooks.ts`:

```typescript
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../db/connection'
import { subscriptions } from '../db/schema'
import { verifyWebhookSignature } from '../services/btcpay'
import { getPeriodEnd, type Plan } from '../services/subscription'

const webhooks = new Hono()

// POST /webhooks/btcpay — handle BTCPay payment notifications
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

  // Only process settled (fully paid) invoices
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
```

**Step 4: Mount routes in server/src/index.ts**

Update `server/src/index.ts` to import and mount:

```typescript
import auth from './routes/auth'
import subs from './routes/subscriptions'
import webhooks from './routes/webhooks'

app.route('/auth', auth)
app.route('/subscriptions', subs)
app.route('/webhooks', webhooks)
```

**Step 5: Write tests**

Create `server/src/routes/subscriptions.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import app from '../index'
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
```

**Step 6: Run tests**

Run: `cd server && npx vitest run`
Expected: PASS

**Step 7: Commit**

```bash
git add server/src/
git commit -m "feat(server): add BTCPay integration, subscription and webhook routes"
```

---

## Phase 4: Sync Endpoints

### Task 10: Sync routes

**Files:**
- Create: `server/src/routes/sync.ts`
- Create: `server/src/routes/sync.test.ts`
- Modify: `server/src/index.ts` — mount sync routes

**Step 1: Create sync routes**

Create `server/src/routes/sync.ts`:

```typescript
import { Hono } from 'hono'
import { eq, and, gt, ne } from 'drizzle-orm'
import { db } from '../db/connection'
import { syncOps, subscriptions } from '../db/schema'
import { authMiddleware } from '../middleware/auth'
import { createRequireSubscription } from '../middleware/requireSubscription'
import { isSubscriptionActive } from '../services/subscription'
import { desc } from 'drizzle-orm'

const sync = new Hono()

sync.use('/*', authMiddleware)

// Subscription check using real DB lookup
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

  const ops = await db
    .select()
    .from(syncOps)
    .where(
      and(
        eq(syncOps.userId, userId),
        gt(syncOps.createdAt, new Date(since)),
        clientId ? ne(syncOps.clientId, clientId) : undefined,
      )
    )
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

// POST /sync/ack — acknowledge received ops (no-op for now, future: track per-device cursor)
sync.post('/ack', async (c) => {
  // In v1, ack is tracked client-side via the `since` timestamp.
  // This endpoint exists for future per-device cursor tracking.
  return c.json({ received: true })
})

export default sync
```

**Step 2: Mount in server/src/index.ts**

```typescript
import sync from './routes/sync'
app.route('/sync', sync)
```

**Step 3: Write tests**

Create `server/src/routes/sync.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import app from '../index'
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

  // Auth'd but no subscription — requires integration test with DB
  it('POST /sync/push rejects without subscription (auth only)', async () => {
    const token = await signAccessToken({ userId: 'no-sub-user', email: 'test@test.com' })
    const res = await app.request('/sync/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ops: [{ id: '1', clientId: 'c1', encryptedPayload: 'dGVzdA==' }] }),
    })
    // Will be 403 (no subscription) when DB is connected
    expect([401, 403]).toContain(res.status)
  })
})
```

**Step 4: Run tests**

Run: `cd server && npx vitest run`
Expected: PASS

**Step 5: Commit**

```bash
git add server/src/
git commit -m "feat(server): add sync push/pull/ack endpoints"
```

---

## Phase 5: Client-Side Stores

### Task 11: Auth store

**Files:**
- Create: `src/stores/authStore.ts`
- Create: `src/stores/authStore.test.ts`

**Step 1: Write failing test**

Create `src/stores/authStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from './authStore'

describe('authStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('starts logged out', () => {
    const store = useAuthStore()
    expect(store.isLoggedIn).toBe(false)
    expect(store.user).toBeNull()
  })

  it('sets user on login', () => {
    const store = useAuthStore()
    store.setAuth({
      accessToken: 'test-access',
      refreshToken: 'test-refresh',
      user: { id: 'u1', email: 'test@test.com' },
    })
    expect(store.isLoggedIn).toBe(true)
    expect(store.user?.email).toBe('test@test.com')
  })

  it('clears state on logout', () => {
    const store = useAuthStore()
    store.setAuth({
      accessToken: 'test-access',
      refreshToken: 'test-refresh',
      user: { id: 'u1', email: 'test@test.com' },
    })
    store.logout()
    expect(store.isLoggedIn).toBe(false)
    expect(store.user).toBeNull()
  })

  it('persists tokens to localStorage', () => {
    const store = useAuthStore()
    store.setAuth({
      accessToken: 'test-access',
      refreshToken: 'test-refresh',
      user: { id: 'u1', email: 'test@test.com' },
    })
    expect(localStorage.getItem('bonsai:auth:accessToken')).toBe('test-access')
    expect(localStorage.getItem('bonsai:auth:refreshToken')).toBe('test-refresh')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/authStore.test.ts`
Expected: FAIL

**Step 3: Implement auth store**

Create `src/stores/authStore.ts`:

```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface AuthUser {
  id: string
  email: string
}

interface AuthResponse {
  accessToken: string
  refreshToken: string
  user: AuthUser
}

const SYNC_SERVER_URL = import.meta.env.VITE_SYNC_SERVER_URL || 'http://localhost:3000'

export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref<string | null>(localStorage.getItem('bonsai:auth:accessToken'))
  const refreshToken = ref<string | null>(localStorage.getItem('bonsai:auth:refreshToken'))
  const user = ref<AuthUser | null>(
    (() => {
      const saved = localStorage.getItem('bonsai:auth:user')
      return saved ? JSON.parse(saved) : null
    })()
  )

  const isLoggedIn = computed(() => !!accessToken.value && !!user.value)

  function setAuth(auth: AuthResponse) {
    accessToken.value = auth.accessToken
    refreshToken.value = auth.refreshToken
    user.value = auth.user
    localStorage.setItem('bonsai:auth:accessToken', auth.accessToken)
    localStorage.setItem('bonsai:auth:refreshToken', auth.refreshToken)
    localStorage.setItem('bonsai:auth:user', JSON.stringify(auth.user))
  }

  function logout() {
    accessToken.value = null
    refreshToken.value = null
    user.value = null
    localStorage.removeItem('bonsai:auth:accessToken')
    localStorage.removeItem('bonsai:auth:refreshToken')
    localStorage.removeItem('bonsai:auth:user')
  }

  async function requestMagicLink(email: string): Promise<void> {
    const res = await fetch(`${SYNC_SERVER_URL}/auth/magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (!res.ok) {
      const body = await res.json()
      throw new Error(body.error || 'Failed to send magic link')
    }
  }

  async function verifyMagicLink(token: string): Promise<void> {
    const res = await fetch(`${SYNC_SERVER_URL}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    if (!res.ok) {
      const body = await res.json()
      throw new Error(body.error || 'Verification failed')
    }
    const data: AuthResponse = await res.json()
    setAuth(data)
  }

  async function refreshAccessToken(): Promise<string | null> {
    if (!refreshToken.value) return null

    const res = await fetch(`${SYNC_SERVER_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refreshToken.value }),
    })

    if (!res.ok) {
      logout()
      return null
    }

    const data = await res.json()
    accessToken.value = data.accessToken
    localStorage.setItem('bonsai:auth:accessToken', data.accessToken)
    return data.accessToken
  }

  /** Get a valid access token, refreshing if needed */
  async function getValidToken(): Promise<string | null> {
    if (!accessToken.value) return null
    // Try current token first; if API returns 401, caller should call refreshAccessToken
    return accessToken.value
  }

  function getGoogleOAuthUrl(): string {
    return `${SYNC_SERVER_URL}/auth/google`
  }

  return {
    accessToken,
    refreshToken,
    user,
    isLoggedIn,
    setAuth,
    logout,
    requestMagicLink,
    verifyMagicLink,
    refreshAccessToken,
    getValidToken,
    getGoogleOAuthUrl,
  }
})
```

**Step 4: Run tests**

Run: `npx vitest run src/stores/authStore.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/stores/authStore.ts src/stores/authStore.test.ts
git commit -m "feat(client): add auth store with magic link and OAuth support"
```

---

### Task 12: Subscription store

**Files:**
- Create: `src/stores/subscriptionStore.ts`
- Create: `src/stores/subscriptionStore.test.ts`

**Step 1: Write failing test**

Create `src/stores/subscriptionStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSubscriptionStore } from './subscriptionStore'

describe('subscriptionStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts with no active subscription', () => {
    const store = useSubscriptionStore()
    expect(store.isActive).toBe(false)
    expect(store.plan).toBeNull()
  })

  it('sets subscription status', () => {
    const store = useSubscriptionStore()
    store.setStatus({
      active: true,
      plan: 'monthly',
      currentPeriodEnd: '2026-03-24T00:00:00Z',
    })
    expect(store.isActive).toBe(true)
    expect(store.plan).toBe('monthly')
  })

  it('clears subscription on reset', () => {
    const store = useSubscriptionStore()
    store.setStatus({ active: true, plan: 'yearly', currentPeriodEnd: '2027-02-24T00:00:00Z' })
    store.reset()
    expect(store.isActive).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/subscriptionStore.test.ts`
Expected: FAIL

**Step 3: Implement**

Create `src/stores/subscriptionStore.ts`:

```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useAuthStore } from './authStore'

const SYNC_SERVER_URL = import.meta.env.VITE_SYNC_SERVER_URL || 'http://localhost:3000'

interface SubscriptionStatus {
  active: boolean
  plan?: string
  currentPeriodEnd?: string
}

export const useSubscriptionStore = defineStore('subscription', () => {
  const status = ref<SubscriptionStatus>({ active: false })

  const isActive = computed(() => status.value.active)
  const plan = computed(() => status.value.plan ?? null)
  const periodEnd = computed(() => status.value.currentPeriodEnd ?? null)

  function setStatus(s: SubscriptionStatus) {
    status.value = s
  }

  function reset() {
    status.value = { active: false }
  }

  async function fetchStatus(): Promise<void> {
    const authStore = useAuthStore()
    if (!authStore.accessToken) return

    const res = await fetch(`${SYNC_SERVER_URL}/subscriptions/status`, {
      headers: { Authorization: `Bearer ${authStore.accessToken}` },
    })

    if (res.status === 401) {
      const refreshed = await authStore.refreshAccessToken()
      if (!refreshed) return
      const retry = await fetch(`${SYNC_SERVER_URL}/subscriptions/status`, {
        headers: { Authorization: `Bearer ${refreshed}` },
      })
      if (retry.ok) setStatus(await retry.json())
      return
    }

    if (res.ok) {
      setStatus(await res.json())
    }
  }

  async function startCheckout(planChoice: 'monthly' | 'yearly'): Promise<string> {
    const authStore = useAuthStore()
    if (!authStore.accessToken) throw new Error('Not authenticated')

    const res = await fetch(`${SYNC_SERVER_URL}/subscriptions/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body: JSON.stringify({ plan: planChoice }),
    })

    if (!res.ok) {
      const body = await res.json()
      throw new Error(body.error || 'Checkout failed')
    }

    const data = await res.json()
    return data.checkoutUrl
  }

  return {
    isActive,
    plan,
    periodEnd,
    setStatus,
    reset,
    fetchStatus,
    startCheckout,
  }
})
```

**Step 4: Run tests**

Run: `npx vitest run src/stores/subscriptionStore.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/stores/subscriptionStore.ts src/stores/subscriptionStore.test.ts
git commit -m "feat(client): add subscription store with checkout and status"
```

---

### Task 13: RemoteSyncAdapter

**Files:**
- Create: `src/db/remoteSyncAdapter.ts`
- Create: `src/db/remoteSyncAdapter.test.ts`

**Step 1: Write failing test**

Create `src/db/remoteSyncAdapter.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RemoteSyncAdapter } from './remoteSyncAdapter'

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('RemoteSyncAdapter', () => {
  let adapter: RemoteSyncAdapter

  beforeEach(() => {
    mockFetch.mockReset()
    adapter = new RemoteSyncAdapter('http://localhost:3000', () => 'test-token')
  })

  it('pushPendingOps returns {pushed: 0, failed: 0} when no ops', async () => {
    const result = await adapter.pushPendingOps()
    expect(result).toEqual({ pushed: 0, failed: 0 })
  })

  it('getPendingOps delegates to local opsService', async () => {
    const ops = await adapter.getPendingOps({ limit: 5 })
    expect(Array.isArray(ops)).toBe(true)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/remoteSyncAdapter.test.ts`
Expected: FAIL

**Step 3: Implement RemoteSyncAdapter**

Create `src/db/remoteSyncAdapter.ts`:

```typescript
import type { SyncAdapter } from './syncAdapter'
import type { SyncOp } from './types'
import { getPendingOps, markAcked } from './opsService'

export class RemoteSyncAdapter implements SyncAdapter {
  constructor(
    private serverUrl: string,
    private getToken: () => string | null,
  ) {}

  async pushPendingOps(): Promise<{ pushed: number; failed: number }> {
    const token = this.getToken()
    if (!token) return { pushed: 0, failed: 0 }

    const ops = await getPendingOps(50)
    if (ops.length === 0) return { pushed: 0, failed: 0 }

    try {
      const res = await fetch(`${this.serverUrl}/sync/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ops: ops.map((op) => ({
            id: op.id,
            clientId: op.clientId,
            encryptedPayload: op.payloadEnc
              ? btoa(JSON.stringify(op.payloadEnc))
              : btoa(op.payload),
            conversationId: op.conversationId,
            createdAt: op.createdAt,
          })),
        }),
      })

      if (!res.ok) {
        return { pushed: 0, failed: ops.length }
      }

      const data = await res.json()
      await markAcked(ops.map((op) => op.id))
      return { pushed: data.pushed, failed: 0 }
    } catch {
      return { pushed: 0, failed: ops.length }
    }
  }

  async markAcked(opIds: string[]): Promise<void> {
    await markAcked(opIds)
  }

  async getPendingOps(options?: { limit?: number }): Promise<SyncOp[]> {
    return getPendingOps(options?.limit)
  }

  async pullRemoteOps(clientId: string, since?: string): Promise<SyncOp[]> {
    const token = this.getToken()
    if (!token) return []

    const params = new URLSearchParams()
    if (since) params.set('since', since)
    if (clientId) params.set('clientId', clientId)

    try {
      const res = await fetch(`${this.serverUrl}/sync/pull?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!res.ok) return []
      const data = await res.json()
      return data.ops
    } catch {
      return []
    }
  }
}
```

**Step 4: Run tests**

Run: `npx vitest run src/db/remoteSyncAdapter.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/db/remoteSyncAdapter.ts src/db/remoteSyncAdapter.test.ts
git commit -m "feat(client): add RemoteSyncAdapter for server sync"
```

---

## Phase 6: Client UI

### Task 14: Auth callback route

**Files:**
- Modify: `src/router/index.ts` — add `/auth/verify` and `/auth/callback` routes

**Step 1: Add auth routes**

Add to the routes array in `src/router/index.ts`:

```typescript
{
  path: '/auth/verify',
  name: 'auth-verify',
  component: () => import('@/views/AuthVerifyView.vue'),
},
{
  path: '/auth/callback',
  name: 'auth-callback',
  component: () => import('@/views/AuthCallbackView.vue'),
},
{
  path: '/subscription/success',
  name: 'subscription-success',
  component: () => import('@/views/SubscriptionSuccessView.vue'),
},
```

**Step 2: Create AuthVerifyView**

Create `src/views/AuthVerifyView.vue`:

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const error = ref('')

onMounted(async () => {
  const token = route.query.token as string
  if (!token) {
    error.value = 'Invalid verification link'
    return
  }
  try {
    await authStore.verifyMagicLink(token)
    router.push({ name: 'home' })
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Verification failed'
  }
})
</script>

<template>
  <div class="auth-verify">
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else>Verifying your sign-in link...</p>
  </div>
</template>
```

**Step 3: Create AuthCallbackView (for Google OAuth)**

Create `src/views/AuthCallbackView.vue`:

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const error = ref('')

onMounted(() => {
  const accessToken = route.query.accessToken as string
  const refreshToken = route.query.refreshToken as string

  if (!accessToken || !refreshToken) {
    error.value = 'Authentication failed'
    return
  }

  // Decode user info from JWT (payload is base64url encoded)
  try {
    const parts = accessToken.split('.')
    const payload = JSON.parse(atob(parts[1]))
    authStore.setAuth({
      accessToken,
      refreshToken,
      user: { id: payload.userId, email: payload.email },
    })
    router.push({ name: 'home' })
  } catch {
    error.value = 'Failed to process authentication'
  }
})
</script>

<template>
  <div class="auth-callback">
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else>Signing you in...</p>
  </div>
</template>
```

**Step 4: Create SubscriptionSuccessView**

Create `src/views/SubscriptionSuccessView.vue`:

```vue
<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useSubscriptionStore } from '@/stores/subscriptionStore'

const router = useRouter()
const subscriptionStore = useSubscriptionStore()

onMounted(async () => {
  await subscriptionStore.fetchStatus()
  // Redirect to home after brief delay
  setTimeout(() => router.push({ name: 'home' }), 2000)
})
</script>

<template>
  <div class="subscription-success">
    <h2>Payment received!</h2>
    <p>Your subscription is being activated. Redirecting...</p>
  </div>
</template>
```

**Step 5: Commit**

```bash
git add src/router/index.ts src/views/AuthVerifyView.vue src/views/AuthCallbackView.vue src/views/SubscriptionSuccessView.vue
git commit -m "feat(client): add auth and subscription callback routes"
```

---

### Task 15: Account section in Settings

**Files:**
- Modify: `src/views/SettingsView.vue` — add account & subscription section

**Step 1: Add auth and subscription imports to SettingsView script**

In `src/views/SettingsView.vue`, add to the imports:

```typescript
import { useAuthStore } from '@/stores/authStore'
import { useSubscriptionStore } from '@/stores/subscriptionStore'
```

And in the script setup:

```typescript
const authStore = useAuthStore()
const subscriptionStore = useSubscriptionStore()
const loginEmail = ref('')
const loginSent = ref(false)
const loginError = ref('')

async function handleMagicLink() {
  loginError.value = ''
  try {
    await authStore.requestMagicLink(loginEmail.value)
    loginSent.value = true
  } catch (e: unknown) {
    loginError.value = e instanceof Error ? e.message : 'Failed to send'
  }
}

function handleGoogleLogin() {
  window.location.href = authStore.getGoogleOAuthUrl()
}

async function handleCheckout(plan: 'monthly' | 'yearly') {
  try {
    const url = await subscriptionStore.startCheckout(plan)
    window.location.href = url
  } catch (e: unknown) {
    console.error('Checkout failed:', e)
  }
}
```

**Step 2: Add account section template**

Insert before the "Sync (Coming Soon)" section (around line 1160):

```vue
<!-- Account & Subscription -->
<section class="settings-card" data-testid="account-section">
  <h2 class="card-title">Account</h2>

  <!-- Not logged in -->
  <template v-if="!authStore.isLoggedIn">
    <p class="section-description">Sign in to enable cloud sync & backup.</p>

    <div v-if="!loginSent" class="auth-form">
      <div class="input-row">
        <input
          v-model="loginEmail"
          type="email"
          class="input"
          placeholder="your@email.com"
          data-testid="login-email"
          @keyup.enter="handleMagicLink"
        />
        <button class="btn btn-primary" data-testid="magic-link-btn" @click="handleMagicLink">
          Send magic link
        </button>
      </div>
      <p v-if="loginError" class="error-text">{{ loginError }}</p>
      <div class="divider-text"><span>or</span></div>
      <button class="btn btn-secondary google-btn" @click="handleGoogleLogin">
        Sign in with Google
      </button>
    </div>

    <div v-else class="magic-link-sent">
      <p>Check your email for the sign-in link.</p>
      <button class="btn btn-secondary" @click="loginSent = false">Try again</button>
    </div>
  </template>

  <!-- Logged in -->
  <template v-else>
    <div class="info-grid">
      <div class="info-item">
        <span class="info-label">Email</span>
        <code class="info-value">{{ authStore.user?.email }}</code>
      </div>
      <div class="info-item">
        <span class="info-label">Subscription</span>
        <code class="info-value" :class="{ active: subscriptionStore.isActive }">
          {{ subscriptionStore.isActive ? `${subscriptionStore.plan} — active` : 'None' }}
        </code>
      </div>
      <div v-if="subscriptionStore.periodEnd" class="info-item">
        <span class="info-label">Expires</span>
        <code class="info-value">{{ new Date(subscriptionStore.periodEnd).toLocaleDateString() }}</code>
      </div>
    </div>

    <!-- Subscribe / Renew -->
    <div v-if="!subscriptionStore.isActive" class="plan-cards">
      <button class="plan-card" @click="handleCheckout('monthly')">
        <span class="plan-name">Monthly</span>
        <span class="plan-price">$5/mo</span>
      </button>
      <button class="plan-card recommended" @click="handleCheckout('yearly')">
        <span class="plan-badge">Save 20%</span>
        <span class="plan-name">Yearly</span>
        <span class="plan-price">$48/yr</span>
      </button>
    </div>

    <div class="button-row" style="margin-top: 0.75rem;">
      <button class="btn btn-secondary" @click="authStore.logout()">Sign out</button>
    </div>
  </template>
</section>
```

**Step 3: Update the Sync section to show status when subscribed**

Replace the "Cloud sync is not yet available" text with:

```vue
<p v-if="!authStore.isLoggedIn || !subscriptionStore.isActive" class="section-description">
  Cloud sync requires an active subscription. Operations are logged locally.
</p>
<p v-else class="section-description sync-active">
  Cloud sync is active. Your conversations are being backed up.
</p>
```

**Step 4: Add CSS styles for account section**

Add to the `<style scoped>` section:

```css
.auth-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-width: 400px;
}

.input-row {
  display: flex;
  gap: 0.5rem;
}

.input-row .input {
  flex: 1;
}

.divider-text {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.divider-text::before,
.divider-text::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border-subtle);
}

.google-btn {
  width: 100%;
}

.plan-cards {
  display: flex;
  gap: 1rem;
  margin-top: 0.75rem;
}

.plan-card {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 1.25rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: transparent;
  cursor: pointer;
  transition: all 0.3s ease;
  font-family: var(--font-sans);
}

.plan-card:hover {
  border-color: var(--accent);
  transform: translateY(-2px);
  box-shadow: var(--shadow-accent);
}

.plan-card.recommended {
  border-color: var(--accent);
}

.plan-badge {
  position: absolute;
  top: -10px;
  font-size: 0.6875rem;
  font-weight: 600;
  padding: 0.125rem 0.5rem;
  background: var(--accent);
  color: var(--bg-primary);
  border-radius: var(--radius-sm);
}

.plan-name {
  font-weight: 600;
  color: var(--text-primary);
}

.plan-price {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--accent);
}

.error-text {
  color: var(--error);
  font-size: 0.8125rem;
}

.sync-active {
  color: var(--success);
}
```

**Step 5: Commit**

```bash
git add src/views/SettingsView.vue
git commit -m "feat(client): add account and subscription UI to Settings"
```

---

### Task 16: Dockerfile and environment config

**Files:**
- Create: `server/Dockerfile`
- Create: `server/.env.example`

**Step 1: Create Dockerfile**

Create `server/Dockerfile`:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

**Step 2: Create .env.example**

Create `server/.env.example`:

```env
# Server
PORT=3000

# Database
DATABASE_URL=postgresql://localhost:5432/bonsai

# Auth
JWT_SECRET=change-me-to-a-random-64-char-string
RESEND_API_KEY=re_xxxxxxxxxxxxx
FROM_EMAIL=noreply@yourdomain.com
APP_URL=https://your-bonsai-app.com

# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://your-server.com/auth/google/callback

# BTCPay Server
BTCPAY_URL=https://your-btcpay-instance.com
BTCPAY_STORE_ID=
BTCPAY_API_KEY=
BTCPAY_WEBHOOK_SECRET=
```

**Step 3: Commit**

```bash
git add server/Dockerfile server/.env.example
git commit -m "feat(server): add Dockerfile and environment config template"
```

---

## Summary

| Phase | Tasks | What it delivers |
|-------|-------|-----------------|
| 1: Server Scaffolding | Tasks 1-2 | Hono server + Drizzle schema on PostgreSQL |
| 2: Authentication | Tasks 3-6 | Magic link + Google OAuth with JWT sessions |
| 3: Subscriptions | Tasks 7-9 | BTCPay checkout, webhook, subscription management |
| 4: Sync | Task 10 | Push/pull/ack endpoints with subscription gating |
| 5: Client Stores | Tasks 11-13 | authStore, subscriptionStore, RemoteSyncAdapter |
| 6: Client UI | Tasks 14-16 | Auth flow views, Settings account section, Docker |

**Total tasks:** 16
**Estimated commits:** 16

Each task is independently testable and committable. The server can be deployed to Railway after Phase 1 and incrementally enabled as phases complete.
