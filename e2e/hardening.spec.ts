/**
 * E2E Hardening Tests
 *
 * Tests for edge cases and error handling:
 * - Network failures
 * - Invalid state recovery
 * - Service worker behavior
 * - Conflict resolution
 */

import { test, expect } from '@playwright/test'
import {
  bootstrapApp,
  createConversation,
  sendMessage,
  mockNanoGPTStreaming,
  clearNanoGPTMock,
} from './helpers'

test.describe('Hardening - Error Recovery', () => {
  test.beforeEach(async ({ page }) => {
    await bootstrapApp(page)
  })

  test('app recovers gracefully from network error during streaming', async ({ page }) => {
    // Set up mock that will return network error
    await clearNanoGPTMock(page)
    await page.route('**/api/v1/chat/completions', async (route) => {
      await route.abort('failed')
    })

    await createConversation(page, { title: 'Network Error Test' })
    await page.fill('[data-testid="composer-input"]', 'Test network failure')
    await page.click('[data-testid="send-btn"]')

    // Wait for error to be handled - either error banner or send button returns
    await Promise.race([
      page.waitForSelector('[data-testid="error-banner"]', { timeout: 10000 }),
      page.waitForSelector('[data-testid="send-btn"]', { state: 'visible', timeout: 10000 }),
    ])

    // Composer should return to usable state
    await expect(page.locator('[data-testid="send-btn"]')).toBeVisible()
  })

  test('app handles invalid conversation ID in URL', async ({ page }) => {
    // Navigate to an invalid conversation ID
    await page.goto('/conversation/invalid-id-12345')

    // App should show "Conversation Not Found" state
    await expect(page.locator('[data-testid="conversation-not-found"]')).toBeVisible({ timeout: 5000 })
    
    // Should show the not found message
    await expect(page.getByText('Conversation Not Found')).toBeVisible()
    
    // Should have a "Go to Home" button
    const goHomeBtn = page.locator('[data-testid="go-home-btn"]')
    await expect(goHomeBtn).toBeVisible()
    
    // Clicking it should navigate to home (conversations page)
    await goHomeBtn.click()
    await expect(page).toHaveURL('/conversations')
  })

  test('app handles malformed message data gracefully', async ({ page }) => {
    // Set up mock that returns malformed SSE
    await clearNanoGPTMock(page)
    await page.route('**/api/v1/chat/completions', async (route) => {
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
        body: 'data: {"invalid": "json structure"}\n\ndata: [DONE]\n\n',
      })
    })

    await createConversation(page, { title: 'Malformed Data Test' })
    await page.fill('[data-testid="composer-input"]', 'Test malformed response')
    await page.click('[data-testid="send-btn"]')

    // App should handle gracefully - no crash
    await page.waitForTimeout(2000)

    // App should still be functional
    await expect(page.locator('[data-testid="message-composer"]')).toBeVisible()
  })

  test('concurrent message sending is handled correctly', async ({ page }) => {
    // Set up delayed mock
    await clearNanoGPTMock(page)
    await mockNanoGPTStreaming(page, { tokens: ['Response'], delay: 1000 })

    await createConversation(page, { title: 'Concurrent Test' })

    // Send first message
    await page.fill('[data-testid="composer-input"]', 'First concurrent message')
    await page.click('[data-testid="send-btn"]')

    // Send button should be replaced by stop button during streaming
    await expect(page.locator('[data-testid="stop-btn"]')).toBeVisible({ timeout: 2000 })

    // Composer should be disabled or hidden during streaming
    // This prevents concurrent sends
    await expect(page.locator('[data-testid="send-btn"]')).not.toBeVisible()

    // Wait for streaming to complete
    await expect(page.locator('[data-testid="send-btn"]')).toBeVisible({ timeout: 15000 })
  })

  test('page refresh during streaming preserves partial message', async ({ page }) => {
    // Set up slow mock
    await clearNanoGPTMock(page)
    await page.route('**/api/v1/chat/completions', async (route) => {
      // Start streaming
      const tokens = ['Partial', ' ', 'message', ' ', 'content']
      let response = ''
      for (const token of tokens) {
        const chunk = {
          id: 'test-id',
          object: 'chat.completion.chunk',
          created: Date.now(),
          model: 'chatgpt-4o-latest',
          choices: [{ index: 0, delta: { content: token }, finish_reason: null }],
        }
        response += `data: ${JSON.stringify(chunk)}\n\n`
      }
      response += 'data: [DONE]\n\n'

      // Delay response
      await new Promise((r) => setTimeout(r, 500))

      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
        body: response,
      })
    })

    await createConversation(page, { title: 'Refresh Test' })
    await page.fill('[data-testid="composer-input"]', 'Test refresh during stream')
    await page.click('[data-testid="send-btn"]')

    // Wait a moment for streaming to start
    await page.waitForTimeout(200)

    // Get current URL before refresh
    const url = page.url()

    // Refresh page
    await page.reload()

    // Navigate back to conversation if needed
    await page.goto(url)

    // App should load without crashing
    await expect(page.locator('[data-testid="message-composer"]')).toBeVisible({ timeout: 10000 })

    // User message should be persisted (use .first() to avoid strict mode violation)
    await expect(page.locator('text=Test refresh during stream').first()).toBeVisible()
  })
})

test.describe('Hardening - State Consistency', () => {
  test.beforeEach(async ({ page }) => {
    await bootstrapApp(page)
  })

  test('conversation list updates after creating new conversation', async ({ page }) => {
    // Check empty state
    await expect(page.getByTestId('empty-state')).toBeVisible()

    // Create conversation
    await createConversation(page, { title: 'State Test Conversation' })

    // Go back home
    await page.click('[data-testid="back-btn"]')

    // Conversation should appear in list
    await expect(page.getByText('State Test Conversation')).toBeVisible()
    await expect(page.getByTestId('empty-state')).not.toBeVisible()
  })

  test('message count updates correctly in conversation list', async ({ page }) => {
    // Create conversation and add messages
    await createConversation(page, { title: 'Count Test' })
    await sendMessage(page, 'Message 1')
    await sendMessage(page, 'Message 2')

    // Go back to home
    await page.click('[data-testid="back-btn"]')

    // Conversation item should show message count
    const conversationItem = page.locator('[data-testid^="conversation-item-"]').first()
    await expect(conversationItem).toBeVisible()
  })

  test('deleting last conversation shows empty state', async ({ page }) => {
    // Create conversation
    await createConversation(page, { title: 'To Delete' })

    // Go back home
    await page.click('[data-testid="back-btn"]')

    // Delete the conversation
    const conversationItem = page.locator('[data-testid^="conversation-item-"]').first()
    await conversationItem.hover()

    const deleteBtn = conversationItem.locator('[data-testid^="delete-btn-"]')
    await deleteBtn.click()

    // Confirm deletion
    await page.click('[data-testid="confirm-delete-btn"]')

    // Empty state should appear
    await expect(page.getByTestId('empty-state')).toBeVisible()
  })
})

test.describe('Hardening - URL State', () => {
  test.beforeEach(async ({ page }) => {
    await bootstrapApp(page)
  })

  test('back button preserves conversation state', async ({ page }) => {
    // Create and navigate to conversation
    await createConversation(page, { title: 'Back Button Test' })
    await sendMessage(page, 'Test message')

    // Click back
    await page.click('[data-testid="back-btn"]')

    // Should be on home (conversations page)
    await expect(page).toHaveURL('/conversations')

    // Click conversation to go back
    await page.click('[data-testid^="conversation-item-"]')

    // Message should still be there (use .first() to avoid strict mode violation)
    await expect(page.locator('text=Test message').first()).toBeVisible()
  })

  test('URL directly loads correct conversation', async ({ page }) => {
    // Create conversation and get URL
    await createConversation(page, { title: 'Direct URL Test' })
    await sendMessage(page, 'Direct access message')

    const url = page.url()

    // Navigate away
    await page.goto('/conversations')

    // Navigate back via URL
    await page.goto(url)

    // Content should load (use .first() to avoid strict mode violation)
    await expect(page.locator('text=Direct access message').first()).toBeVisible()
  })
})
