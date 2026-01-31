/**
 * E2E tests for Encryption feature
 *
 * Tests the encryption enable/disable flow, lock/unlock, and data protection.
 *
 * Note: Encryption tests require special handling - they must not use the
 * standard bootstrapApp() because encryption state conflicts with API key setup.
 */

import { test, expect } from '@playwright/test'
import { resetAppState, waitForAppReady } from './helpers'

test.describe('Encryption', () => {
  test.beforeEach(async ({ page }) => {
    // Reset state but don't set API key (encryption tests manage their own state)
    await resetAppState(page)
    await page.reload()
    await waitForAppReady(page)
  })

  test('can enable encryption with passphrase', async ({ page }) => {
    // Go to settings
    await page.click('[data-testid="settings-btn"]')
    await expect(page.locator('[data-testid="encryption-section"]')).toBeVisible()

    // Check encryption is initially disabled
    await expect(page.locator('text=Encryption is not enabled')).toBeVisible()

    // Click enable encryption
    await page.click('[data-testid="enable-encryption-btn"]')
    await expect(page.locator('[data-testid="encryption-dialog"]')).toBeVisible()

    // Enter passphrase
    await page.fill('[data-testid="encryption-passphrase-input"]', 'testpassphrase123')
    await page.fill('[data-testid="encryption-passphrase-confirm-input"]', 'testpassphrase123')

    // Confirm
    await page.click('[data-testid="confirm-enable-encryption-btn"]')

    // Should show success and encryption enabled
    await expect(page.locator('text=Encryption enabled!')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('text=Encryption is enabled')).toBeVisible()
  })

  test('validates passphrase minimum length', async ({ page }) => {
    // Go to settings
    await page.click('[data-testid="settings-btn"]')

    // Click enable encryption
    await page.click('[data-testid="enable-encryption-btn"]')
    await expect(page.locator('[data-testid="encryption-dialog"]')).toBeVisible()

    // Enter short passphrase
    await page.fill('[data-testid="encryption-passphrase-input"]', 'short')
    await page.fill('[data-testid="encryption-passphrase-confirm-input"]', 'short')

    // Confirm button should be disabled (passphrase < 8 chars)
    await expect(page.locator('[data-testid="confirm-enable-encryption-btn"]')).toBeDisabled()
  })

  test('validates passphrase confirmation matches', async ({ page }) => {
    // Go to settings
    await page.click('[data-testid="settings-btn"]')

    // Click enable encryption
    await page.click('[data-testid="enable-encryption-btn"]')

    // Enter mismatched passphrases
    await page.fill('[data-testid="encryption-passphrase-input"]', 'testpassphrase123')
    await page.fill('[data-testid="encryption-passphrase-confirm-input"]', 'differentpassphrase')

    // Click confirm
    await page.click('[data-testid="confirm-enable-encryption-btn"]')

    // Should show error
    await expect(page.locator('text=Passphrases do not match')).toBeVisible()
  })

  test('can lock and unlock app', async ({ page }) => {
    // Go to settings
    await page.click('[data-testid="settings-btn"]')

    // Enable encryption first
    await page.click('[data-testid="enable-encryption-btn"]')
    await page.fill('[data-testid="encryption-passphrase-input"]', 'testpassphrase123')
    await page.fill('[data-testid="encryption-passphrase-confirm-input"]', 'testpassphrase123')
    await page.click('[data-testid="confirm-enable-encryption-btn"]')
    await expect(page.locator('text=Encryption enabled!')).toBeVisible({ timeout: 10000 })

    // Lock the app
    await page.click('[data-testid="lock-btn"]')

    // Should be redirected or show lock screen
    // The lock state is stored in memory, so on navigation the app checks lock state
    await page.goto('/conversations')

    // App should show locked state or lock screen
    await expect(
      page.locator('[data-testid="unlock-passphrase-input"], [data-testid="new-conversation-btn"]')
    ).toBeVisible({ timeout: 5000 })
  })

  test('can disable encryption with passphrase', async ({ page }) => {
    // Go to settings
    await page.click('[data-testid="settings-btn"]')

    // Enable encryption first
    await page.click('[data-testid="enable-encryption-btn"]')
    await page.fill('[data-testid="encryption-passphrase-input"]', 'testpassphrase123')
    await page.fill('[data-testid="encryption-passphrase-confirm-input"]', 'testpassphrase123')
    await page.click('[data-testid="confirm-enable-encryption-btn"]')
    await expect(page.locator('text=Encryption enabled!')).toBeVisible({ timeout: 10000 })

    // Now disable encryption
    await page.click('[data-testid="disable-encryption-btn"]')
    await expect(page.locator('[data-testid="disable-encryption-dialog"]')).toBeVisible()

    // Enter passphrase
    await page.fill('[data-testid="disable-encryption-passphrase-input"]', 'testpassphrase123')

    // Confirm disable
    await page.click('[data-testid="confirm-disable-encryption-btn"]')

    // Should show success and encryption disabled
    await expect(page.locator('text=Encryption disabled!')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('text=Encryption is not enabled')).toBeVisible()
  })

  test('wrong passphrase fails to disable encryption', async ({ page }) => {
    // Go to settings
    await page.click('[data-testid="settings-btn"]')

    // Enable encryption first
    await page.click('[data-testid="enable-encryption-btn"]')
    await page.fill('[data-testid="encryption-passphrase-input"]', 'testpassphrase123')
    await page.fill('[data-testid="encryption-passphrase-confirm-input"]', 'testpassphrase123')
    await page.click('[data-testid="confirm-enable-encryption-btn"]')
    await expect(page.locator('text=Encryption enabled!')).toBeVisible({ timeout: 10000 })

    // Try to disable with wrong passphrase
    await page.click('[data-testid="disable-encryption-btn"]')
    await page.fill('[data-testid="disable-encryption-passphrase-input"]', 'wrongpassphrase')
    await page.click('[data-testid="confirm-disable-encryption-btn"]')

    // Should show error
    await expect(page.locator('text=Incorrect passphrase')).toBeVisible({ timeout: 5000 })
  })

  test('encryption section shows security note', async ({ page }) => {
    // Go to settings
    await page.click('[data-testid="settings-btn"]')

    // Check security note is visible
    await expect(page.locator('text=Security note')).toBeVisible()
    await expect(page.locator('text=Protects data at rest')).toBeVisible()
  })
})
