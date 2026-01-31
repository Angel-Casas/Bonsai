/**
 * Shared E2E Helpers for Bonsai Playwright Tests
 *
 * This module centralizes common test setup patterns to:
 * 1. Reduce duplication across spec files
 * 2. Ensure deterministic test behavior
 * 3. Provide a single place to update when app behavior changes
 *
 * Usage:
 *   import { resetAppState, bootstrapConversation, mockNanoGPTStreaming } from './helpers'
 *
 *   test.beforeEach(async ({ page }) => {
 *     await resetAppState(page)
 *     await mockNanoGPTStreaming(page)
 *   })
 *
 *   test('my test', async ({ page }) => {
 *     await bootstrapConversation(page, { title: 'Test' })
 *     // ... rest of test
 *   })
 */

import { Page } from '@playwright/test'

// ============================================================================
// Constants
// ============================================================================

export const API_KEY_STORAGE_KEY = 'bonsai:nanogpt:apiKey'
export const DEFAULT_TEST_API_KEY = 'test-api-key-e2e-12345'
export const DATABASE_NAME = 'BonsaiDB'

// ============================================================================
// SSE Response Builder
// ============================================================================

/**
 * Creates a well-formed SSE (Server-Sent Events) response body
 * that mimics the NanoGPT streaming API format.
 *
 * @param tokens - Array of string tokens to stream
 * @param options - Optional configuration
 * @returns SSE-formatted response body string
 */
export function createSSEResponse(
  tokens: string[],
  options?: {
    model?: string
    requestId?: string
  }
): string {
  const model = options?.model ?? 'chatgpt-4o-latest'
  const requestId = options?.requestId ?? 'test-request-id'

  let response = ''
  for (const token of tokens) {
    const chunk = {
      id: requestId,
      object: 'chat.completion.chunk',
      created: Date.now(),
      model,
      choices: [
        {
          index: 0,
          delta: { content: token },
          finish_reason: null,
        },
      ],
    }
    response += `data: ${JSON.stringify(chunk)}\n\n`
  }
  response += 'data: [DONE]\n\n'
  return response
}

// ============================================================================
// Reset State Helper
// ============================================================================

/**
 * Clears localStorage and deletes IndexedDB to ensure a clean test state.
 * This should be called at the start of each test (in beforeEach).
 *
 * @param page - Playwright page object
 */
export async function resetAppState(page: Page): Promise<void> {
  // Navigate to app root first (needed for evaluate to work in app context)
  await page.goto('/conversations')

  // Clear IndexedDB
  await page.evaluate((dbName) => {
    return new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(dbName)
      request.onsuccess = () => resolve()
      request.onerror = () => resolve()
      request.onblocked = () => resolve()
    })
  }, DATABASE_NAME)

  // Clear localStorage (but preserve any test-specific items if needed)
  await page.evaluate(() => {
    localStorage.clear()
  })
}

// ============================================================================
// API Key Setup Helper
// ============================================================================

/**
 * Sets up a NanoGPT API key in localStorage.
 * Must be called before page reload for the app to pick it up.
 *
 * @param page - Playwright page object
 * @param apiKey - API key to set (defaults to test key)
 */
export async function setApiKey(
  page: Page,
  apiKey: string = DEFAULT_TEST_API_KEY
): Promise<void> {
  await page.evaluate(
    ({ key, value }) => {
      localStorage.setItem(key, value)
    },
    { key: API_KEY_STORAGE_KEY, value: apiKey }
  )
}

/**
 * Clears the NanoGPT API key from localStorage.
 *
 * @param page - Playwright page object
 */
export async function clearApiKey(page: Page): Promise<void> {
  await page.evaluate((key) => {
    localStorage.removeItem(key)
  }, API_KEY_STORAGE_KEY)
}

// ============================================================================
// Mock NanoGPT Streaming Helper
// ============================================================================

export interface MockStreamingOptions {
  /** Tokens to return in the streaming response */
  tokens?: string[]
  /** Delay before responding (ms) - useful for testing loading states */
  delay?: number
  /** HTTP status code to return */
  status?: number
  /** Error response body (for testing error handling) */
  errorBody?: object
  /** Custom response headers */
  headers?: Record<string, string>
}

/**
 * Installs Playwright route interception to mock NanoGPT streaming API calls.
 * Returns a well-formed SSE stream with [DONE] marker.
 *
 * @param page - Playwright page object
 * @param options - Mock configuration options
 */
export async function mockNanoGPTStreaming(
  page: Page,
  options?: MockStreamingOptions
): Promise<void> {
  const tokens = options?.tokens ?? ['OK']
  const delay = options?.delay ?? 0
  const status = options?.status ?? 200
  const errorBody = options?.errorBody
  const customHeaders = options?.headers ?? {}

  await page.route('**/api/v1/chat/completions', async (route) => {
    // Optional delay for testing loading states
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay))
    }

    // Error response
    if (status !== 200 || errorBody) {
      await route.fulfill({
        status,
        headers: {
          'Content-Type': 'application/json',
          ...customHeaders,
        },
        body: JSON.stringify(errorBody ?? { error: { message: 'Error' } }),
      })
      return
    }

    // Success streaming response
    const sseBody = createSSEResponse(tokens)
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...customHeaders,
      },
      body: sseBody,
    })
  })
}

/**
 * Clears any installed route handlers for NanoGPT API.
 * Useful when you need to change mock behavior mid-test.
 *
 * @param page - Playwright page object
 */
export async function clearNanoGPTMock(page: Page): Promise<void> {
  await page.unroute('**/api/v1/chat/completions')
}

// ============================================================================
// Bootstrap App Helper
// ============================================================================

export interface BootstrapOptions {
  /** Conversation title (optional - uses default if not provided) */
  title?: string
  /** Whether to set up API key (defaults to true) */
  withApiKey?: boolean
  /** Whether to set up streaming mock (defaults to true) */
  withStreamingMock?: boolean
  /** Custom tokens for streaming mock */
  mockTokens?: string[]
}

/**
 * Complete app bootstrap: clears state, sets API key, sets up mocks, and reloads.
 * This is the recommended way to start most E2E tests.
 *
 * @param page - Playwright page object
 * @param options - Bootstrap configuration options
 */
export async function bootstrapApp(
  page: Page,
  options?: BootstrapOptions
): Promise<void> {
  const withApiKey = options?.withApiKey ?? true
  const withStreamingMock = options?.withStreamingMock ?? true
  const mockTokens = options?.mockTokens ?? ['OK']

  // 1. Reset state (clears IndexedDB + localStorage)
  await resetAppState(page)

  // 2. Set up API key if requested
  if (withApiKey) {
    await setApiKey(page)
  }

  // 3. Reload to pick up localStorage changes
  await page.reload()

  // 4. Set up streaming mock if requested
  if (withStreamingMock) {
    await mockNanoGPTStreaming(page, { tokens: mockTokens })
  }

  // 5. Wait for app to be ready
  await page.waitForSelector('[data-testid="app-header"]')
}

// ============================================================================
// Conversation Creation Helper
// ============================================================================

export interface CreateConversationOptions {
  /** Conversation title */
  title?: string
  /** Whether to wait for URL change */
  waitForNavigation?: boolean
}

/**
 * Creates a new conversation through the UI flow:
 * 1. Click new-conversation-btn
 * 2. Fill title (if provided)
 * 3. Click create-conversation-btn
 * 4. Wait for conversation view to load
 *
 * @param page - Playwright page object
 * @param options - Conversation creation options
 * @returns The conversation ID from the URL
 */
export async function createConversation(
  page: Page,
  options?: CreateConversationOptions
): Promise<string> {
  const title = options?.title ?? 'Test Conversation'
  const waitForNavigation = options?.waitForNavigation ?? true

  // Open new conversation dialog
  await page.click('[data-testid="new-conversation-btn"]')

  // Fill title
  await page.fill('[data-testid="new-conversation-input"]', title)

  // Create conversation
  await page.click('[data-testid="create-conversation-btn"]')

  // Wait for navigation to conversation view
  if (waitForNavigation) {
    await page.waitForURL(/\/conversation\//)
    await page.waitForSelector('[data-testid="message-composer"]')
  }

  // Extract and return conversation ID from URL
  const url = page.url()
  const match = url.match(/\/conversation\/([^?/]+)/)
  return match?.[1] ?? ''
}

// ============================================================================
// Message Sending Helper
// ============================================================================

export interface SendMessageOptions {
  /** Wait for assistant response to appear */
  waitForResponse?: boolean
  /** Expected response content (for assertion) */
  expectedResponse?: string
  /** Timeout for waiting (ms) */
  timeout?: number
}

/**
 * Sends a message via the composer using the Send button (consistent approach).
 * This is the standardized way to send messages in E2E tests.
 *
 * Decision: Always use click on send-btn rather than keyboard shortcuts
 * for consistency and reliability across all tests.
 *
 * @param page - Playwright page object
 * @param content - Message content to send
 * @param options - Send options
 */
export async function sendMessage(
  page: Page,
  content: string,
  options?: SendMessageOptions
): Promise<void> {
  const waitForResponse = options?.waitForResponse ?? true
  const expectedResponse = options?.expectedResponse
  const timeout = options?.timeout ?? 10000

  // Fill composer input
  await page.fill('[data-testid="composer-input"]', content)

  // Click send button (standardized approach - not keyboard shortcut)
  await page.click('[data-testid="send-btn"]')

  // Wait for user message to appear in timeline
  await page.waitForSelector(`text=${content}`, { timeout })

  // Wait for assistant response if requested
  if (waitForResponse && expectedResponse) {
    await page.waitForSelector(`text=${expectedResponse}`, { timeout })
  } else if (waitForResponse) {
    // Wait for any assistant message (streaming complete)
    // Give time for the mock to respond
    await page.waitForTimeout(500)
  }
}

// ============================================================================
// Branch Creation Helper
// ============================================================================

export interface CreateBranchOptions {
  /** Branch title (optional) */
  branchTitle?: string
  /** First message content in the branch */
  content: string
}

/**
 * Creates a branch from a message element.
 * The message element should be hovered first to reveal the branch button.
 *
 * @param page - Playwright page object
 * @param messageLocator - Locator for the message to branch from
 * @param options - Branch creation options
 */
export async function createBranchFromMessage(
  page: Page,
  messageIndex: number,
  options: CreateBranchOptions
): Promise<void> {
  // Find the message in the timeline
  const message = page.locator('[data-testid^="timeline-message-"]').nth(messageIndex)

  // Hover to reveal branch button
  await message.hover()

  // Click branch button
  const branchBtn = message.locator('[data-testid^="branch-btn-"]')
  await branchBtn.click()

  // Wait for branch dialog
  await page.waitForSelector('[data-testid="branch-dialog"]')

  // Fill branch title if provided
  if (options.branchTitle) {
    await page.fill('[data-testid="branch-title-input"]', options.branchTitle)
  }

  // Fill branch content
  await page.fill('[data-testid="branch-content-input"]', options.content)

  // Create branch
  await page.click('[data-testid="create-branch-btn"]')

  // Wait for dialog to close and new message to appear
  await page.waitForSelector('[data-testid="branch-dialog"]', { state: 'hidden' })
}

// ============================================================================
// View Mode Helpers
// ============================================================================

export type ViewMode = 'tree' | 'split' | 'graph'

/**
 * Sets the view mode in a conversation.
 *
 * @param page - Playwright page object
 * @param mode - The view mode to set
 */
export async function setViewMode(page: Page, mode: ViewMode): Promise<void> {
  await page.click(`[data-testid="view-mode-${mode}"]`)

  // Wait for view to update based on mode
  switch (mode) {
    case 'split':
      await page.waitForSelector('[data-testid="split-view-container"]')
      break
    case 'graph':
      await page.waitForSelector('[data-testid="graph-view-container"]')
      break
    case 'tree':
      // Tree view is default - just ensure split/graph are hidden
      await page.waitForSelector('[data-testid="message-timeline"]')
      break
  }
}

// ============================================================================
// Search Helpers
// ============================================================================

/**
 * Opens the search panel.
 *
 * @param page - Playwright page object
 */
export async function openSearch(page: Page): Promise<void> {
  await page.click('[data-testid="search-btn"]')
  await page.waitForSelector('[data-testid="search-panel"]')
}

/**
 * Searches for a term and optionally clicks a result.
 *
 * @param page - Playwright page object
 * @param query - Search query
 * @param clickFirstResult - Whether to click the first result
 */
export async function searchAndSelect(
  page: Page,
  query: string,
  clickFirstResult: boolean = false
): Promise<void> {
  await openSearch(page)
  await page.fill('[data-testid="search-input"]', query)

  // Wait for debounce
  await page.waitForTimeout(300)

  if (clickFirstResult) {
    const result = page.locator('[data-testid^="search-result-"]').first()
    await result.click()
    // Panel should close after selection
    await page.waitForSelector('[data-testid="search-panel"]', { state: 'hidden' })
  }
}

// ============================================================================
// Wait Helpers
// ============================================================================

/**
 * Waits for streaming to complete by checking for stop-btn disappearance.
 *
 * @param page - Playwright page object
 * @param timeout - Maximum wait time (ms)
 */
export async function waitForStreamingComplete(
  page: Page,
  timeout: number = 10000
): Promise<void> {
  // Wait for stop button to disappear (streaming complete)
  await page.waitForSelector('[data-testid="stop-btn"]', {
    state: 'hidden',
    timeout,
  })
  // Ensure send button is back
  await page.waitForSelector('[data-testid="send-btn"]')
}

/**
 * Waits for the app to be ready (header visible).
 *
 * @param page - Playwright page object
 */
export async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="app-header"]')
}
