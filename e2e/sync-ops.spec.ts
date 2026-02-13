import { test, expect } from '@playwright/test'
import { bootstrapApp, createConversation, openSettings } from './helpers'

test.describe('Sync Operations Log', () => {
  test.beforeEach(async ({ page }) => {
    await bootstrapApp(page)
  })

  test('shows pending ops count in Settings after creating a conversation', async ({ page }) => {
    // Create a conversation (emits conversation.create op)
    await createConversation(page, { title: 'Sync Test Conversation' })

    // Navigate to Settings
    await openSettings(page)

    // Find sync section
    const syncSection = page.locator('[data-testid="sync-section"]')
    await expect(syncSection).toBeVisible()

    // Click refresh to ensure stats are current
    await page.click('[data-testid="refresh-sync-btn"]')

    // Pending count should be >= 1 (at least the conversation.create op)
    const pendingCount = page.locator('[data-testid="sync-pending-count"]')
    await expect(pendingCount).not.toHaveText('0')

    // Client ID should be populated
    const clientId = page.locator('[data-testid="sync-client-id"]')
    await expect(clientId).not.toHaveText('—')

    // Latest ops should show conversation.create
    const latestOps = page.locator('[data-testid="sync-latest-ops"]')
    await expect(latestOps).toContainText('conversation.create')
  })
})
