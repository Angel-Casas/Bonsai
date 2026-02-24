# Subscription & Sync Server Design

**Date:** 2026-02-24
**Status:** Approved

## 1. Overview

Bonsai adds a paid subscription that unlocks encrypted cloud sync & backup. Users pay with cryptocurrency via self-hosted BTCPay Server. The app remains offline-first — all data stays in IndexedDB locally, and the subscription enables pushing encrypted ops to a server for cross-device sync and backup.

**Pricing:** $5/month or $48/year (~20% discount).

## 2. System Architecture

```
┌─────────────────┐     ┌──────────────────────────┐     ┌─────────────────┐
│  Bonsai Client   │────▶│  Bonsai Sync Server       │     │  BTCPay Server   │
│  (Vue PWA)       │◀────│  (Node.js/Hono on Railway) │◀───▶│  (Railway/VPS)   │
└─────────────────┘     └──────────────────────────┘     └─────────────────┘
                                    │
                              ┌─────▼─────┐
                              │ PostgreSQL │
                              │ (Railway)  │
                              └───────────┘
```

- **Bonsai Client** (existing Vue PWA) — adds auth UI, subscription management, wires up `RemoteSyncAdapter`
- **Bonsai Sync Server** — new Node.js/Hono service: auth, subscription verification, encrypted ops sync
- **BTCPay Server** — self-hosted crypto payment processor (BTC, Lightning, LTC, ETH, XMR, etc.)
- **PostgreSQL** — users, subscriptions, encrypted sync ops

**Hosting:** Railway (monolith server + managed PostgreSQL). BTCPay Server on Railway or a separate VPS.

## 3. Database Schema

```sql
-- Users
users (
  id              UUID PRIMARY KEY,
  email           TEXT UNIQUE NOT NULL,
  google_id       TEXT UNIQUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  last_login_at   TIMESTAMPTZ
)

-- Magic link tokens
magic_links (
  id              UUID PRIMARY KEY,
  user_id         UUID REFERENCES users(id),
  token_hash      TEXT NOT NULL,          -- SHA-256 of emailed token
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ
)

-- Subscriptions
subscriptions (
  id                    UUID PRIMARY KEY,
  user_id               UUID REFERENCES users(id),
  plan                  TEXT NOT NULL,     -- 'monthly' | 'yearly'
  status                TEXT NOT NULL,     -- 'active' | 'expired' | 'cancelled'
  current_period_start  TIMESTAMPTZ NOT NULL,
  current_period_end    TIMESTAMPTZ NOT NULL,
  btcpay_invoice_id     TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
)

-- Encrypted sync operations (server stores opaque blobs)
sync_ops (
  id                  UUID PRIMARY KEY,
  user_id             UUID REFERENCES users(id),
  client_id           TEXT NOT NULL,
  encrypted_payload   BYTEA NOT NULL,     -- AES-256-GCM, server never decrypts
  conversation_id     TEXT,               -- for filtering, provided by client
  created_at          TIMESTAMPTZ DEFAULT NOW()
)

-- Sessions (refresh tokens)
sessions (
  id              UUID PRIMARY KEY,
  user_id         UUID REFERENCES users(id),
  token_hash      TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
)
```

Server never sees plaintext conversation data — only encrypted blobs.

## 4. Authentication

### Magic Link Flow
1. User enters email → `POST /auth/magic-link`
2. Server creates user if new, generates token, stores SHA-256 hash (15 min expiry)
3. Email sent via Resend (free tier: 3k/month)
4. User clicks link → `POST /auth/verify` with token
5. Server verifies hash, creates session, returns JWT access token + refresh token

### Google OAuth Flow
1. User clicks "Sign in with Google" → standard OAuth2 redirect
2. Google callback with auth code → server exchanges for profile
3. Server creates/links user, issues JWT

### Session Management
- Access token: JWT, 15 min TTL
- Refresh token: 30 day TTL, stored in `sessions` table
- Client auto-refreshes on expiry

## 5. Payment & Subscription Flow

### Checkout
1. Authenticated user calls `POST /subscriptions/checkout` with `{ plan: 'monthly' | 'yearly' }`
2. Server creates BTCPay invoice via Greenfield API ($5 or $48 USD equivalent)
3. Server returns BTCPay checkout URL
4. Client redirects user to BTCPay hosted checkout
5. User pays with preferred crypto

### Activation
1. BTCPay sends webhook to `POST /webhooks/btcpay` on payment confirmation
2. Server verifies webhook signature
3. Server creates/extends subscription: `status = 'active'`, `current_period_end = now + 30d` (or 365d)
4. Client detects activation via `GET /subscriptions/status`

### Lifecycle
- **No auto-renewal** — crypto can't do recurring charges. Client prompts user to renew before expiry.
- **Expiry** — checked on each API call (or cron job). Sync stops but local data remains.
- **Future Stripe** — `POST /subscriptions/checkout` accepts `provider` param. Stripe enables auto-renewal.

## 6. Sync Flow

### Server Endpoints (require active subscription)
- `POST /sync/push` — receive encrypted ops from client
- `GET /sync/pull?since={timestamp}&clientId={id}` — return ops from other devices
- `POST /sync/ack` — client acknowledges received ops

### Client Integration
- New `RemoteSyncAdapter` implements existing `SyncAdapter` interface
- Replaces `LocalOnlySyncAdapter` when user is authenticated + subscribed
- Sync triggers: every 30 seconds + on app focus
- Encryption happens client-side (AES-256-GCM) before ops leave the device

## 7. Server Project Structure (monorepo)

```
server/
  src/
    index.ts                    -- Hono app entry
    routes/
      auth.ts                   -- magic link + Google OAuth
      subscriptions.ts          -- checkout + status + webhook
      sync.ts                   -- push/pull/ack
    services/
      email.ts                  -- Resend integration
      btcpay.ts                 -- BTCPay Greenfield API client
      subscription.ts           -- subscription logic + expiry
    middleware/
      auth.ts                   -- JWT verification
      requireSubscription.ts    -- active subscription check
    db/
      schema.ts                 -- Drizzle ORM schema
      migrations/
  Dockerfile
  package.json
```

### Tech Stack
- **Hono** — HTTP framework
- **Drizzle ORM** — type-safe PostgreSQL queries
- **Resend** — magic link emails
- **jose** — JWT signing/verification
- **BTCPay Greenfield API** — invoice creation + webhook verification

## 8. Client-Side Changes

### New Stores
- `authStore` — JWT tokens, user info, login/logout
- `subscriptionStore` — subscription status, checkout redirect, renewal

### New UI
- Auth screen (email input + Google sign-in)
- Subscription page (plan selection, subscribe button, status)
- Account section in Settings (email, status, expiry, renew button)

### Modified
- `SyncAdapter` selection: `RemoteSyncAdapter` when authed + subscribed, `LocalOnlySyncAdapter` otherwise
- Settings page: account/subscription section

## 9. Non-Goals (v1)

- No conflict resolution UI (last-write-wins)
- No real-time WebSocket sync (polling only)
- No multi-device simultaneous editing
- No Stripe integration (future)
- No storage limits (revisit if needed)
