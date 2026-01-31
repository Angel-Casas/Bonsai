/**
 * E2E tests for Search functionality (Milestone 6)
 *
 * Tests:
 * 1. Create conversation with messages and branch title
 * 2. Search for terms matching branch title and content
 * 3. Verify clicking results changes active message
 */

import { test, expect } from '@playwright/test'
import {
  bootstrapApp,
  createConversation,
  sendMessage,
  createBranchFromMessage,
  openSearch,
} from './helpers'

test.describe('Search functionality', () => {
  test.beforeEach(async ({ page }) => {
    await bootstrapApp(page)
  })

  test('can search messages and branch titles', async ({ page }) => {
    await createConversation(page, { title: 'Search Test' })

    // Add first user message with unique keyword
    await sendMessage(page, 'Tell me about marketing strategies')

    // Add another message
    await page.waitForTimeout(300)
    await sendMessage(page, 'What about digital advertising campaigns?')

    // Create a branch with title "Marketing" from first message
    await createBranchFromMessage(page, 0, {
      branchTitle: 'Marketing Plan',
      content: 'Let me explore marketing options',
    })

    // Wait for branch to be created
    await page.waitForTimeout(500)

    // Open search panel
    await openSearch(page)

    // Search for "marketing" - should match both branch title and content
    await page.fill('[data-testid="search-input"]', 'marketing')

    // Wait for search results (debounce delay)
    await page.waitForTimeout(300)

    // Should have results
    const results = page.locator('[data-testid^="search-result-"]')
    await expect(results.first()).toBeVisible()

    // Click on first result
    const firstResultId = await results.first().getAttribute('data-testid')
    const messageId = firstResultId?.replace('search-result-', '')

    await results.first().click()

    // Search panel should close
    await expect(page.locator('[data-testid="search-panel"]')).not.toBeVisible()

    // The clicked message should now be in the timeline
    if (messageId) {
      await expect(page.locator(`[data-testid="timeline-message-${messageId}"]`)).toBeVisible()
    }
  })

  test('search with keyboard shortcut (Cmd/Ctrl+F)', async ({ page }) => {
    await createConversation(page, { title: 'Search Shortcut Test' })

    // Add a message first
    await sendMessage(page, 'Test message for search')

    // Click somewhere neutral to unfocus composer
    await page.click('h1')

    // Use keyboard shortcut to open search
    await page.keyboard.press('Meta+f')

    // Search panel should open
    await expect(page.locator('[data-testid="search-panel"]')).toBeVisible()

    // Search input should be focused
    await expect(page.locator('[data-testid="search-input"]')).toBeFocused()

    // Type search query
    await page.keyboard.type('test')

    // Wait for results
    await page.waitForTimeout(300)

    // Should have a result
    await expect(page.locator('[data-testid^="search-result-"]').first()).toBeVisible()

    // Press Escape to close
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-testid="search-panel"]')).not.toBeVisible()
  })

  test('search shows no results state', async ({ page }) => {
    await createConversation(page, { title: 'No Results Test' })

    // Add a message
    await sendMessage(page, 'Hello world')

    // Open search
    await openSearch(page)

    // Search for non-existent term
    await page.fill('[data-testid="search-input"]', 'xyznonexistent')
    await page.waitForTimeout(300)

    // Should show "no results" message
    await expect(page.getByText('No results found')).toBeVisible()
  })

  test('search result shows branch title badge', async ({ page }) => {
    await createConversation(page, { title: 'Branch Badge Test' })

    // Add a message
    await sendMessage(page, 'Original message content')

    // Create a branch with specific title
    await createBranchFromMessage(page, 0, {
      branchTitle: 'Alternative Approach',
      content: 'Trying something different',
    })
    await page.waitForTimeout(500)

    // Open search and search for "Alternative"
    await openSearch(page)
    await page.fill('[data-testid="search-input"]', 'Alternative')
    await page.waitForTimeout(300)

    // Should show title match indicator
    await expect(page.getByText('title match')).toBeVisible()
  })
})
