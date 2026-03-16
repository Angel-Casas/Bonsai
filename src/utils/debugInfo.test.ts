/**
 * Debug Info Utility Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { collectDebugInfo, formatDebugInfo, validateNoSecrets } from './debugInfo'

// Mock the db module
vi.mock('@/db', () => ({
  db: {
    conversations: {
      count: vi.fn().mockResolvedValue(5),
    },
    messages: {
      count: vi.fn().mockResolvedValue(42),
    },
    verno: 3,
    name: 'BonsaiDB',
  },
}))

// Mock the encryption module
vi.mock('@/db/encryption', () => ({
  isEncryptionEnabled: vi.fn().mockReturnValue(false),
  isLocked: vi.fn().mockReturnValue(false),
}))

describe('debugInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('collectDebugInfo', () => {
    it('collects app version', async () => {
      const info = await collectDebugInfo()
      expect(info.appVersion).toBeDefined()
      expect(typeof info.appVersion).toBe('string')
    })

    it('collects build mode', async () => {
      const info = await collectDebugInfo()
      expect(info.buildMode).toBeDefined()
    })

    it('collects database info', async () => {
      const info = await collectDebugInfo()
      expect(info.dbSchemaVersion).toBe(3)
      expect(info.dbName).toBe('BonsaiDB')
    })

    it('collects encryption status', async () => {
      const info = await collectDebugInfo()
      expect(typeof info.encryptionEnabled).toBe('boolean')
      expect(typeof info.isLocked).toBe('boolean')
    })

    it('collects counts', async () => {
      const info = await collectDebugInfo()
      expect(info.conversationCount).toBe(5)
      expect(info.messageCount).toBe(42)
    })

    it('collects user agent', async () => {
      const info = await collectDebugInfo()
      expect(info.userAgent).toBeDefined()
      expect(typeof info.userAgent).toBe('string')
    })

    it('includes timestamp', async () => {
      const info = await collectDebugInfo()
      expect(info.timestamp).toBeDefined()
      expect(new Date(info.timestamp).getTime()).not.toBeNaN()
    })
  })

  describe('formatDebugInfo', () => {
    it('formats info as readable text', async () => {
      const info = await collectDebugInfo()
      const formatted = formatDebugInfo(info)

      expect(formatted).toContain('Bonsai Debug Info')
      expect(formatted).toContain('App Version:')
      expect(formatted).toContain('Database:')
      expect(formatted).toContain('Conversations:')
      expect(formatted).toContain('Messages:')
    })

    it('does not contain secrets', async () => {
      const info = await collectDebugInfo()
      const formatted = formatDebugInfo(info)

      expect(validateNoSecrets(formatted)).toBe(true)
    })
  })

  describe('validateNoSecrets', () => {
    it('returns true for safe text', () => {
      expect(validateNoSecrets('App Version: 1.0.0')).toBe(true)
      expect(validateNoSecrets('Conversations: 5')).toBe(true)
      expect(validateNoSecrets('Build Mode: production')).toBe(true)
    })

    it('returns false for text containing API key patterns', () => {
      expect(validateNoSecrets('apiKey: abc123')).toBe(false)
      expect(validateNoSecrets('api_key=secret')).toBe(false)
    })

    it('returns false for text containing password patterns', () => {
      expect(validateNoSecrets('password: mypassword')).toBe(false)
      expect(validateNoSecrets('passphrase: secret')).toBe(false)
    })

    it('returns false for text containing encryption patterns', () => {
      expect(validateNoSecrets('salt: xyz')).toBe(false)
      expect(validateNoSecrets('iv=abc')).toBe(false)
      expect(validateNoSecrets('ciphertext: encrypted')).toBe(false)
      expect(validateNoSecrets('keyHash: hash')).toBe(false)
    })

    it('returns false for text containing token patterns', () => {
      expect(validateNoSecrets('token: abc123')).toBe(false)
      expect(validateNoSecrets('secret: xyz')).toBe(false)
    })
  })
})
