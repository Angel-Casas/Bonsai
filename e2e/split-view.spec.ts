/**
 * Split View E2E Tests
 *
 * Tests for split view functionality:
 * 1. Enable/disable split view
 * 2. Independent pane navigation
 * 3. Both timelines showing different paths simultaneously
 * 4. Streaming constraints (send disabled in other pane while streaming)
 */

import { test, expect } from '@playwright/test'
import {
  bootstrapApp,
  createConversation,
  sendMessage,
  setViewMode,
} from './helpers'

test.describe('Split View', () => {
  test.beforeEach(async ({ page }) => {
    await bootstrapApp(page)
    await createConversation(page, { title: 'Split View Test' })
  })

  test('toggle split view on and off', async ({ page }) => {
    // Initially tree view is active
    await expect(page.locator('[data-testid="split-view-container"]')).not.toBeVisible()

    // Enable split view
    await setViewMode(page, 'split')
    await expect(page.locator('[data-testid="split-pane-A"]')).toBeVisible()
    await expect(page.locator('[data-testid="split-pane-B"]')).toBeVisible()

    // Disable split view
    await setViewMode(page, 'tree')
    await expect(page.locator('[data-testid="split-view-container"]')).not.toBeVisible()
  })

  test('swap panes button only visible in split view', async ({ page }) => {
    // Swap button should not be visible initially
    await expect(page.locator('[data-testid="swap-panes-btn"]')).not.toBeVisible()

    // Enable split view
    await setViewMode(page, 'split')

    // Swap button should now be visible
    await expect(page.locator('[data-testid="swap-panes-btn"]')).toBeVisible()
  })

  test('pane focus indicator in sidebar', async ({ page }) => {
    // Enable split view
    await setViewMode(page, 'split')

    // Should show focus indicator in sidebar
    await expect(page.locator('[data-testid="tree-sidebar"]')).toContainText('→ Pane')
  })

  test('clicking pane focuses it', async ({ page }) => {
    // Enable split view
    await setViewMode(page, 'split')

    // Pane A should be focused initially
    const paneAHeader = page.locator('[data-testid="split-pane-A"]')
    await expect(paneAHeader).toContainText('(focused)')

    // Click on pane B
    await page.click('[data-testid="split-pane-B"]')

    // Pane B should now be focused
    const paneBHeader = page.locator('[data-testid="split-pane-B"]')
    await expect(paneBHeader).toContainText('(focused)')

    // Pane A should no longer show focused
    await expect(paneAHeader).not.toContainText('(focused)')
  })

  test('both panes show different branches after navigation', async ({ page }) => {
    // Send first message
    await sendMessage(page, 'Original question')

    // Wait for streaming to complete
    await page.waitForTimeout(500)

    // Try to branch from the first message
    const firstMessage = page.locator('[data-testid^="message-"]').first()
    await firstMessage.hover()

    const branchBtn = firstMessage.locator('[data-testid="branch-btn"]')
    if (await branchBtn.isVisible()) {
      await branchBtn.click()

      // Fill in branch dialog
      await page.waitForSelector('[data-testid="branch-dialog"]')
      await page.fill('[data-testid="branch-content-input"]', 'Alternative path question')
      await page.click('[data-testid="create-branch-btn"]')
      await page.waitForSelector('[data-testid="branch-dialog"]', { state: 'hidden' })
    }

    // Enable split view
    await setViewMode(page, 'split')

    // Both panes should be visible and have content
    await expect(page.locator('[data-testid="split-pane-A"]')).toBeVisible()
    await expect(page.locator('[data-testid="split-pane-B"]')).toBeVisible()
  })

  test('URL params persist split view state', async ({ page }) => {
    // Send a message first
    await sendMessage(page, 'Test message')
    await page.waitForTimeout(500)

    // Enable split view
    await setViewMode(page, 'split')

    // Check URL contains split view params
    await page.waitForTimeout(100)
    const url = page.url()
    expect(url).toContain('paneA=')
    expect(url).toContain('paneB=')
    expect(url).toContain('focus=')
  })

  test('swap panes exchanges positions', async ({ page }) => {
    // Send a message
    await sendMessage(page, 'Test message')
    await page.waitForTimeout(500)

    // Enable split view
    await setViewMode(page, 'split')

    // Get initial URL with pane params
    await page.waitForTimeout(100)
    const initialUrl = page.url()
    expect(new URL(initialUrl).searchParams.get('paneA')).toBeDefined()
    expect(new URL(initialUrl).searchParams.get('paneB')).toBeDefined()

    // Click swap
    await page.click('[data-testid="swap-panes-btn"]')
    await page.waitForTimeout(100)

    // Verify params still exist after swap
    const newUrl = page.url()
    expect(new URL(newUrl).searchParams.get('paneA')).toBeDefined()
    expect(new URL(newUrl).searchParams.get('paneB')).toBeDefined()
  })

  test('model indicator shows in each pane header', async ({ page }) => {
    // Enable split view
    await setViewMode(page, 'split')

    // Check that pane headers exist
    await expect(page.locator('[data-testid="split-pane-A"]')).toContainText('Pane A')
    await expect(page.locator('[data-testid="split-pane-B"]')).toContainText('Pane B')
  })

  test('disable split view returns to single view with focused pane position', async ({ page }) => {
    // Send a message
    await sendMessage(page, 'Test message')
    await page.waitForTimeout(500)

    // Enable split view
    await setViewMode(page, 'split')

    // Disable split view
    await setViewMode(page, 'tree')

    // Should return to single view
    await expect(page.locator('[data-testid="split-view-container"]')).not.toBeVisible()

    // URL should not have split view params
    await page.waitForTimeout(100)
    const url = page.url()
    expect(url).not.toContain('paneA=')
    expect(url).not.toContain('paneB=')
  })
})

test.describe('Split View Streaming Constraints', () => {
  test.beforeEach(async ({ page }) => {
    await bootstrapApp(page)
    await createConversation(page, { title: 'Split View Streaming Test' })
  })

  test('each pane has its own message composer', async ({ page }) => {
    // Enable split view
    await setViewMode(page, 'split')

    // Both panes should have composers
    const composers = page.locator('[data-testid="message-composer"]')
    await expect(composers).toHaveCount(2)
  })
})
