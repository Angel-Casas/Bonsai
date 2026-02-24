import { describe, it, expect } from 'vitest'
import { users, magicLinks, subscriptions, syncOps, sessions } from './schema.js'

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
