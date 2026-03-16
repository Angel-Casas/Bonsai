/**
 * E2E Tests for Milestone 13: Public Launch Polish
 *
 * Tests for first-run guardrails, context clarity, and supportability features.
 */

import { test, expect } from '@playwright/test'
import { resetAppState, waitForAppReady, createConversation } from './helpers'

test.describe('Public Launch Polish', () => {
  test.beforeEach(async ({ page }) => {
    // Reset state WITHOUT setting API key
    await resetAppState(page)
    await page.reload()
    await waitForAppReady(page)
  })

  test.describe('API Key Missing Guardrail', () => {
    test('send button is disabled when API key is missing', async ({ page }) => {
      // Create a conversation
      await createConversation(page, { title: 'No API Key Test' })

      // Type a message
      await page.fill('[data-testid="composer-input"]', 'Test message')

      // Send button should be disabled
      const sendBtn = page.getByTestId('send-btn')
      await expect(sendBtn).toBeDisabled()

      // Should show API key required in tooltip
      await expect(sendBtn).toHaveAttribute('title', /API key required/)
    })

    test('shows status message when API key is missing', async ({ page }) => {
      // Create a conversation
      await createConversation(page, { title: 'Status Test' })

      // Type a message
      await page.fill('[data-testid="composer-input"]', 'Test message')

      // Should show no-api-key status
      await expect(page.getByTestId('no-api-key-status')).toBeVisible()
      await expect(page.getByTestId('no-api-key-status')).toContainText('API key')
    })

    test('shows "Set API key now" button on auth error from API', async ({ page }) => {
      // Set an invalid API key (so button is enabled but API call will fail)
      await page.click('[data-testid="settings-btn"]')
      await page.fill('[data-testid="api-key-input"]', 'invalid-api-key')
      await page.click('[data-testid="save-api-key-btn"]')
      await page.click('[data-testid="settings-btn"]') // Go back

      // Create a conversation
      await createConversation(page, { title: 'Auth Error Test' })

      // Try to send a message (should fail with auth error)
      await page.fill('[data-testid="composer-input"]', 'Test message')
      await page.click('[data-testid="send-btn"]')

      // Error banner should appear with "Set API key now" button
      await expect(page.getByTestId('error-banner')).toBeVisible({ timeout: 10000 })
      await expect(page.getByTestId('set-api-key-btn')).toBeVisible()
      await expect(page.getByTestId('set-api-key-btn')).toHaveText('Set API key now')
    })

    test('"Set API key now" button navigates to settings', async ({ page }) => {
      // Set an invalid API key
      await page.click('[data-testid="settings-btn"]')
      await page.fill('[data-testid="api-key-input"]', 'invalid-api-key')
      await page.click('[data-testid="save-api-key-btn"]')
      await page.click('[data-testid="settings-btn"]') // Go back

      // Create a conversation
      await createConversation(page, { title: 'Navigate Test' })

      // Trigger the error
      await page.fill('[data-testid="composer-input"]', 'Test message')
      await page.click('[data-testid="send-btn"]')

      // Wait for error banner
      await expect(page.getByTestId('error-banner')).toBeVisible({ timeout: 10000 })

      // Click the "Set API key now" button
      await page.click('[data-testid="set-api-key-btn"]')

      // Should open settings overlay
      await expect(page.getByTestId('api-key-section')).toBeVisible()
    })

    test('error banner shows link to get API key', async ({ page }) => {
      // Set an invalid API key
      await page.click('[data-testid="settings-btn"]')
      await page.fill('[data-testid="api-key-input"]', 'invalid-api-key')
      await page.click('[data-testid="save-api-key-btn"]')
      await page.click('[data-testid="settings-btn"]') // Go back

      // Create a conversation
      await createConversation(page, { title: 'Link Test' })

      // Trigger the error
      await page.fill('[data-testid="composer-input"]', 'Test message')
      await page.click('[data-testid="send-btn"]')

      // Wait for error banner
      await expect(page.getByTestId('error-banner')).toBeVisible({ timeout: 10000 })

      // Should show link to NanoGPT
      const link = page.locator('.error-link')
      await expect(link).toContainText('NanoGPT')
      await expect(link).toHaveAttribute('href', /nano-gpt\.com/)
    })
  })

  test.describe('Offline Behavior', () => {
    test('shows offline status message when offline', async ({ page, context }) => {
      // Create a conversation first
      await createConversation(page, { title: 'Offline Test' })

      // Go offline
      await context.setOffline(true)

      // Wait for offline detection
      await page.waitForTimeout(500)

      // Should show offline status in composer
      await expect(page.getByTestId('offline-status')).toBeVisible()
      await expect(page.getByTestId('offline-status')).toContainText('offline')

      // Restore online
      await context.setOffline(false)
    })

    test('send button is disabled when offline', async ({ page, context }) => {
      // Create a conversation first
      await createConversation(page, { title: 'Offline Send Test' })

      // Go offline
      await context.setOffline(true)
      await page.waitForTimeout(500)

      // Type a message
      await page.fill('[data-testid="composer-input"]', 'Test message')

      // Send button should be disabled
      const sendBtn = page.getByTestId('send-btn')
      await expect(sendBtn).toBeDisabled()

      // Restore online
      await context.setOffline(false)
    })
  })

  test.describe('Copy Debug Info', () => {
    test('copy debug info button exists in settings', async ({ page }) => {
      // Navigate to settings
      await page.click('[data-testid="settings-btn"]')

      // Support section should be visible
      await expect(page.getByTestId('support-section')).toBeVisible()

      // Copy debug info button should exist
      await expect(page.getByTestId('copy-debug-info')).toBeVisible()
    })

    test('copy debug info button copies to clipboard', async ({ page }) => {
      // Navigate to settings
      await page.click('[data-testid="settings-btn"]')

      // Grant clipboard permissions
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

      // Click copy debug info
      await page.click('[data-testid="copy-debug-info"]')

      // Button should show "Copied!"
      await expect(page.getByTestId('copy-debug-info')).toContainText('Copied!')

      // Clipboard should contain debug info
      const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
      expect(clipboardText).toContain('Bonsai Debug Info')
      expect(clipboardText).toContain('App Version')
      expect(clipboardText).not.toContain('apiKey')
      expect(clipboardText).not.toContain('passphrase')
    })
  })

  test.describe('Deep Search Warning', () => {
    test('shows warning when deep search is enabled', async ({ page }) => {
      // First set API key
      await page.click('[data-testid="settings-btn"]')
      await page.fill('[data-testid="api-key-input"]', 'test-key-12345')
      await page.click('[data-testid="save-api-key-btn"]')

      // Go back to conversations list and reload to ensure clean state
      await page.goto('/conversations')
      await page.reload()
      await waitForAppReady(page)

      // Wait for new conversation button to be available
      await page.waitForSelector('[data-testid="new-conversation-btn"]', { timeout: 10000 })

      // Create a conversation
      await createConversation(page, { title: 'Deep Search Test' })

      // Enable web search
      await page.click('[data-testid="web-search-toggle"]')

      // Wait for search preset button to appear
      await expect(page.getByTestId('search-preset-btn')).toBeVisible()

      // Select deep search preset
      await page.click('[data-testid="search-preset-btn"]')
      await page.click('[data-testid="search-preset-dropdown"] >> text=Deep')

      // Warning should be visible
      await expect(page.getByTestId('deep-search-warning')).toBeVisible()
      await expect(page.getByTestId('deep-search-warning')).toContainText('slower')
      await expect(page.getByTestId('deep-search-warning')).toContainText('expensive')
    })
  })
})
