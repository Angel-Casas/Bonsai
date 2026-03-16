/**
 * Feedback URL Builder Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildFeedbackUrl,
  GITHUB_REPO_PATH,
  PRIVACY_WARNING_TEXT,
} from './feedbackUrl'
import { validateNoSecrets } from './debugInfo'

// Mock the debugInfo module
vi.mock('./debugInfo', async () => {
  const actual = await vi.importActual('./debugInfo')
  return {
    ...actual,
    collectDebugInfo: vi.fn().mockResolvedValue({
      appVersion: '0.1.0',
      buildMode: 'production',
      dbSchemaVersion: 2,
      dbName: 'BonsaiDB',
      encryptionEnabled: false,
      isLocked: false,
      conversationCount: 5,
      messageCount: 50,
      serviceWorkerStatus: 'active',
      userAgent: 'Mozilla/5.0 Test Browser',
      timestamp: '2026-01-31T12:00:00.000Z',
    }),
    formatDebugInfo: vi.fn().mockReturnValue(`Bonsai Debug Info
==================
App Version: 0.1.0
Build Mode: production
Database: BonsaiDB (schema v2)
Encryption: disabled
Conversations: 5
Messages: 50
Service Worker: active
User Agent: Mozilla/5.0 Test Browser
Collected: 2026-01-31T12:00:00.000Z`),
    validateNoSecrets: vi.fn().mockReturnValue(true),
  }
})

describe('feedbackUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('buildFeedbackUrl', () => {
    it('builds a bug report URL with correct repo path', async () => {
      const result = await buildFeedbackUrl({ type: 'bug' })

      expect(result.success).toBe(true)
      expect(result.url).toContain(`github.com/${GITHUB_REPO_PATH}/issues/new`)
    })

    it('builds a feature request URL with correct repo path', async () => {
      const result = await buildFeedbackUrl({ type: 'feature' })

      expect(result.success).toBe(true)
      expect(result.url).toContain(`github.com/${GITHUB_REPO_PATH}/issues/new`)
    })

    it('includes correct template param for bug report', async () => {
      const result = await buildFeedbackUrl({ type: 'bug' })

      expect(result.url).toContain('template=bug_report.yml')
    })

    it('includes correct template param for feature request', async () => {
      const result = await buildFeedbackUrl({ type: 'feature' })

      expect(result.url).toContain('template=feature_request.yml')
    })

    it('includes privacy warning in bug report body', async () => {
      const result = await buildFeedbackUrl({ type: 'bug' })

      // URL-decode the body to check content
      const decodedUrl = decodeURIComponent(result.url)
      expect(decodedUrl).toContain('Privacy Reminder')
      expect(decodedUrl).toContain('Do NOT include')
    })

    it('includes privacy warning in feature request body', async () => {
      const result = await buildFeedbackUrl({ type: 'feature' })

      const decodedUrl = decodeURIComponent(result.url)
      expect(decodedUrl).toContain('Privacy Reminder')
    })

    it('includes debug info in the body', async () => {
      const result = await buildFeedbackUrl({ type: 'bug' })

      const decodedUrl = decodeURIComponent(result.url)
      expect(decodedUrl).toContain('App Version')
      expect(decodedUrl).toContain('BonsaiDB')
    })

    it('validates body does not contain secrets', async () => {
      const result = await buildFeedbackUrl({ type: 'bug' })

      expect(validateNoSecrets).toHaveBeenCalled()
      expect(result.success).toBe(true)
    })

    it('uses minimal URL when body contains secrets', async () => {
      // Make validateNoSecrets return false
      vi.mocked(validateNoSecrets).mockReturnValueOnce(false)

      const result = await buildFeedbackUrl({ type: 'bug' })

      expect(result.success).toBe(true)
      expect(result.error).toBe('Could not prefill content safely')
      // URL should not contain body param with debug info
      expect(result.url).not.toContain('body=')
    })

    it('generated URL does not contain known secret patterns', async () => {
      const result = await buildFeedbackUrl({ type: 'bug' })
      const decodedUrl = decodeURIComponent(result.url)

      // Check for absence of sensitive patterns
      expect(decodedUrl).not.toMatch(/apiKey/i)
      expect(decodedUrl).not.toMatch(/api_key/i)
      expect(decodedUrl).not.toMatch(/passphrase/i)
      expect(decodedUrl).not.toMatch(/password/i)
      expect(decodedUrl).not.toMatch(/secret/i)
      expect(decodedUrl).not.toMatch(/token/i)
    })

    it('prefills title placeholder for bug report', async () => {
      const result = await buildFeedbackUrl({ type: 'bug' })

      expect(result.url).toContain('title=')
      const decodedUrl = decodeURIComponent(result.url)
      expect(decodedUrl).toContain('[Bug]:')
    })

    it('prefills title placeholder for feature request', async () => {
      const result = await buildFeedbackUrl({ type: 'feature' })

      expect(result.url).toContain('title=')
      const decodedUrl = decodeURIComponent(result.url)
      expect(decodedUrl).toContain('[Feature]:')
    })
  })

  describe('PRIVACY_WARNING_TEXT', () => {
    it('contains key privacy instructions', () => {
      expect(PRIVACY_WARNING_TEXT).toContain('Privacy Reminder')
      expect(PRIVACY_WARNING_TEXT).toContain('Do NOT')
      expect(PRIVACY_WARNING_TEXT).toContain('API key')
    })
  })
})
