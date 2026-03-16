/**
 * E2E Tests for NanoGPT Streaming
 *
 * Strategy: Uses Playwright's route interception to mock the NanoGPT API
 * without requiring real network calls. The mock returns SSE-formatted
 * streaming responses that the app processes incrementally.
 */

import { test, expect } from '@playwright/test'
import {
  bootstrapApp,
  createConversation,
  sendMessage,
  mockNanoGPTStreaming,
  clearNanoGPTMock,
  clearApiKey,
  openSettings,
} from './helpers'

test.describe('NanoGPT Streaming', () => {
  test.beforeEach(async ({ page }) => {
    await bootstrapApp(page)
  })

  test('displays model selector in composer', async ({ page }) => {
    await createConversation(page)
    await expect(page.locator('[data-testid="model-selector-btn"]')).toBeVisible()
  })

  test('displays web search toggle in composer', async ({ page }) => {
    await createConversation(page)
    await expect(page.locator('[data-testid="web-search-toggle"]')).toBeVisible()
  })

  test('can toggle web search mode', async ({ page }) => {
    await createConversation(page)

    const toggle = page.locator('[data-testid="web-search-toggle"]')
    await expect(toggle).toContainText('Web Search')

    // Turn on
    await toggle.click()
    await expect(toggle).toContainText('Web Search On')

    // Search preset selector should appear
    await expect(page.locator('[data-testid="search-preset-btn"]')).toBeVisible()
  })

  test('settings panel allows API key configuration', async ({ page }) => {
    await openSettings(page)

    await expect(page.locator('[data-testid="api-key-section"]')).toBeVisible()

    // API key should be configured (from bootstrapApp)
    await expect(page.locator('text=API key configured')).toBeVisible()
  })

  test('shows masked API key in settings', async ({ page }) => {
    await openSettings(page)

    const maskedKey = page.locator('[data-testid="masked-api-key"]')
    await expect(maskedKey).toBeVisible()
    await expect(maskedKey).toContainText('••••')
  })

  test('can open settings from home', async ({ page }) => {
    await page.click('[data-testid="settings-btn"]')

    await expect(page.locator('h1')).toContainText('Settings')
  })

  test('model dropdown shows available models', async ({ page }) => {
    await createConversation(page)

    // Open model dropdown
    await page.click('[data-testid="model-selector-btn"]')

    // Check dropdown is visible
    await expect(page.locator('[data-testid="model-dropdown"]')).toBeVisible()

    // Should have search input
    await expect(page.locator('[data-testid="model-search-input"]')).toBeVisible()

    // Should have model options (check for provider groups and model names)
    await expect(page.locator('[data-testid="model-dropdown"]')).toContainText('OpenAI')
    await expect(page.locator('[data-testid="model-dropdown"]')).toContainText('Use conversation default')
  })

  test('effective model shows with web search suffix', async ({ page }) => {
    await createConversation(page)

    // Turn on web search
    await page.click('[data-testid="web-search-toggle"]')

    // Check effective model shows :online suffix
    const effectiveModel = page.locator('[data-testid="effective-model"]')
    await expect(effectiveModel).toContainText(':online')
  })

  test('mocked streaming response updates message incrementally', async ({ page }) => {
    // Set up custom streaming mock with multiple tokens
    await clearNanoGPTMock(page)
    await mockNanoGPTStreaming(page, {
      tokens: ['Hello', ', ', 'this ', 'is ', 'a ', 'streaming ', 'response!'],
    })

    await createConversation(page)
    await sendMessage(page, 'Hello AI!', { waitForResponse: false })

    // Wait for assistant message with full streamed content
    await expect(
      page.locator('text=Hello, this is a streaming response!')
    ).toBeVisible({ timeout: 10000 })
  })

  test('streaming response is persisted and survives page reload', async ({ page }) => {
    // Set up custom mock
    await clearNanoGPTMock(page)
    await mockNanoGPTStreaming(page, {
      tokens: ['Persisted', ' ', 'response', ' ', 'content'],
    })

    await createConversation(page)
    await sendMessage(page, 'Test persistence', { waitForResponse: false })

    // Wait for assistant message (use first() to avoid strict mode error)
    await expect(
      page.locator('text=Persisted response content').first()
    ).toBeVisible({ timeout: 10000 })

    // Reload the page
    await page.reload()

    // Wait for page to load
    await expect(page.locator('[data-testid="message-composer"]')).toBeVisible()

    // Verify the content is still there
    await expect(
      page.locator('text=Persisted response content').first()
    ).toBeVisible({ timeout: 5000 })
  })

  test('shows streaming indicator during response generation', async ({ page }) => {
    // Set up mock with delay
    await clearNanoGPTMock(page)
    await mockNanoGPTStreaming(page, { tokens: ['Response'], delay: 500 })

    await createConversation(page)
    await page.fill('[data-testid="composer-input"]', 'Test streaming indicator')
    await page.click('[data-testid="send-btn"]')

    // Streaming indicator should appear
    await expect(page.locator('[data-testid="streaming-indicator"]')).toBeVisible({ timeout: 2000 })

    // Wait for streaming to complete
    await expect(page.locator('text=Response')).toBeVisible({ timeout: 10000 })

    // Streaming indicator should disappear
    await expect(page.locator('[data-testid="streaming-indicator"]')).not.toBeVisible()
  })

  test('shows stop button during streaming and allows cancellation', async ({ page }) => {
    let responseResolve: () => void
    const responsePromise = new Promise<void>((resolve) => {
      responseResolve = resolve
    })

    // Set up a controlled slow response
    await clearNanoGPTMock(page)
    await page.route('**/api/v1/chat/completions', async (route) => {
      // Send partial response
      const tokens = ['Partial', ' ', 'content', ' ', 'before']
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

      // Wait for abort or timeout
      await Promise.race([responsePromise, new Promise((r) => setTimeout(r, 5000))])

      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
        body: response + 'data: [DONE]\n\n',
      })
    })

    await createConversation(page)
    await page.fill('[data-testid="composer-input"]', 'Test stop button')
    await page.click('[data-testid="send-btn"]')

    // Stop button should appear
    await expect(page.locator('[data-testid="stop-btn"]')).toBeVisible({ timeout: 2000 })

    // Click stop button
    await page.click('[data-testid="stop-btn"]')
    responseResolve!()

    // Stop button should disappear and send button should return
    await expect(page.locator('[data-testid="stop-btn"]')).not.toBeVisible({ timeout: 5000 })
    await expect(page.locator('[data-testid="send-btn"]')).toBeVisible()
  })

  test('disables send button when API key is missing', async ({ page }) => {
    // Clear the API key
    await clearApiKey(page)
    await page.reload()

    await createConversation(page)
    await page.fill('[data-testid="composer-input"]', 'Test without API key')

    // Send button should be disabled when API key is missing
    const sendBtn = page.locator('[data-testid="send-btn"]')
    await expect(sendBtn).toBeDisabled()
    await expect(sendBtn).toHaveAttribute('title', /API key required/)

    // Status message should indicate API key is needed
    await expect(page.locator('[data-testid="no-api-key-status"]')).toBeVisible()
  })

  test('shows error banner for 401 response with "Set API key now" button', async ({ page }) => {
    // Set up mock with 401 error
    await clearNanoGPTMock(page)
    await mockNanoGPTStreaming(page, {
      status: 401,
      errorBody: { error: { message: 'Invalid API key' } },
    })

    await createConversation(page)
    await page.fill('[data-testid="composer-input"]', 'Test 401 error')
    await page.click('[data-testid="send-btn"]')

    // Error banner should appear with authentication error
    const errorBanner = page.locator('[data-testid="error-banner"]')
    await expect(errorBanner).toBeVisible({ timeout: 5000 })

    // Should contain auth-related keywords and status code
    await expect(errorBanner).toContainText(/[Aa]uthentication/)
    await expect(errorBanner).toContainText('401')

    // "Set API key now" button should be visible for auth errors
    const setApiKeyBtn = page.locator('[data-testid="set-api-key-btn"]')
    await expect(setApiKeyBtn).toBeVisible()
    await expect(setApiKeyBtn).toHaveText('Set API key now')

    // Clicking should open settings overlay
    await setApiKeyBtn.click()
    await expect(page.locator('[data-testid="api-key-section"]')).toBeVisible()
  })

  test('shows error banner for 403 response with "Set API key now" button', async ({ page }) => {
    // Set up mock with 403 error
    await clearNanoGPTMock(page)
    await mockNanoGPTStreaming(page, {
      status: 403,
      errorBody: { error: { message: 'Forbidden' } },
    })

    await createConversation(page)
    await page.fill('[data-testid="composer-input"]', 'Test 403 error')
    await page.click('[data-testid="send-btn"]')

    // Error banner should appear with authentication error
    const errorBanner = page.locator('[data-testid="error-banner"]')
    await expect(errorBanner).toBeVisible({ timeout: 5000 })

    // Should contain auth-related keywords and status code
    await expect(errorBanner).toContainText(/[Aa]uthentication/)
    await expect(errorBanner).toContainText('403')

    // "Set API key now" button should be visible for auth errors
    await expect(page.locator('[data-testid="set-api-key-btn"]')).toBeVisible()
  })

  test('error banner can be dismissed', async ({ page }) => {
    // Set up mock with error
    await clearNanoGPTMock(page)
    await mockNanoGPTStreaming(page, {
      status: 401,
      errorBody: { error: { message: 'Invalid API key' } },
    })

    await createConversation(page)
    await page.fill('[data-testid="composer-input"]', 'Test dismiss error')
    await page.click('[data-testid="send-btn"]')

    // Error banner should appear
    const errorBanner = page.locator('[data-testid="error-banner"]')
    await expect(errorBanner).toBeVisible({ timeout: 5000 })
    
    // Dismiss the error
    await page.click('[data-testid="error-banner-dismiss"]')
    
    // Error banner should be hidden
    await expect(errorBanner).not.toBeVisible()
  })

  test('error banner clears on successful send', async ({ page }) => {
    // First cause an error
    await clearNanoGPTMock(page)
    await mockNanoGPTStreaming(page, {
      status: 401,
      errorBody: { error: { message: 'Invalid API key' } },
    })

    await createConversation(page)
    await page.fill('[data-testid="composer-input"]', 'Trigger error')
    await page.click('[data-testid="send-btn"]')

    // Error banner should appear
    const errorBanner = page.locator('[data-testid="error-banner"]')
    await expect(errorBanner).toBeVisible({ timeout: 5000 })

    // Now set up successful mock
    await clearNanoGPTMock(page)
    await mockNanoGPTStreaming(page, { tokens: ['Success!'] })

    // Send another message
    await page.fill('[data-testid="composer-input"]', 'This should succeed')
    await page.click('[data-testid="send-btn"]')

    // Error banner should clear (it's cleared before streaming starts)
    await expect(errorBanner).not.toBeVisible({ timeout: 5000 })
    
    // Success response should appear
    await expect(page.locator('text=Success!').first()).toBeVisible({ timeout: 10000 })
  })

  test('send button is disabled during streaming', async ({ page }) => {
    // Set up mock with delay
    await clearNanoGPTMock(page)
    await mockNanoGPTStreaming(page, { tokens: ['Response'], delay: 1000 })

    await createConversation(page)
    await page.fill('[data-testid="composer-input"]', 'Test disabled send')
    await page.click('[data-testid="send-btn"]')

    // During streaming, we should see stop button instead of send
    await expect(page.locator('[data-testid="stop-btn"]')).toBeVisible({ timeout: 2000 })
    await expect(page.locator('[data-testid="send-btn"]')).not.toBeVisible()

    // Wait for completion
    await expect(page.locator('text=Response')).toBeVisible({ timeout: 10000 })

    // Send button should be back
    await expect(page.locator('[data-testid="send-btn"]')).toBeVisible()
  })
})
