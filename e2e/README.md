# Bonsai E2E Tests

End-to-end tests for the Bonsai application using Playwright.

## Running Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run specific test file
npx playwright test e2e/streaming.spec.ts

# Run tests with UI mode (for debugging)
npx playwright test --ui

# Run with headed browser (visible)
npx playwright test --headed

# Run a single test by name
npx playwright test -g "mocked streaming response"

# View test report
npx playwright show-report
```

## Test Structure

```
e2e/
├── helpers.ts           # Shared test utilities (see below)
├── app.spec.ts          # Basic app loading tests
├── conversation.spec.ts # Conversation creation and branching
├── streaming.spec.ts    # NanoGPT streaming and mocking
├── search.spec.ts       # Search functionality
├── split-view.spec.ts   # Split view mode
├── graph-view.spec.ts   # Graph visualization
├── edit-delete.spec.ts  # Message editing and deletion
├── encryption.spec.ts   # Encryption enable/disable/lock
├── export-import.spec.ts # Data export/import
├── hardening.spec.ts    # Error recovery and edge cases
└── README.md            # This file
```

## Shared Helpers (`helpers.ts`)

All tests should use the centralized helpers to ensure consistency and reduce duplication.

### Core Setup Helpers

```typescript
import { bootstrapApp, createConversation, sendMessage } from './helpers'

test.beforeEach(async ({ page }) => {
  // Full bootstrap: clears state, sets API key, sets up streaming mock
  await bootstrapApp(page)
})

test('my test', async ({ page }) => {
  // Create a conversation through the UI
  await createConversation(page, { title: 'My Test' })
  
  // Send a message (uses click on send-btn, not keyboard)
  await sendMessage(page, 'Hello!', { waitForResponse: true })
})
```

### Available Helpers

| Helper | Description |
|--------|-------------|
| `bootstrapApp(page, options?)` | Full app setup: clear state, set API key, set up mocks |
| `resetAppState(page)` | Clear localStorage and IndexedDB |
| `setApiKey(page, key?)` | Set NanoGPT API key in localStorage |
| `clearApiKey(page)` | Remove API key from localStorage |
| `mockNanoGPTStreaming(page, options?)` | Install route interception for streaming |
| `clearNanoGPTMock(page)` | Remove route interception |
| `createConversation(page, options?)` | Create conversation via UI flow |
| `sendMessage(page, content, options?)` | Send message via composer |
| `createBranchFromMessage(page, index, options)` | Branch from a message |
| `setViewMode(page, mode)` | Switch view mode (tree/split/graph) |
| `openSearch(page)` | Open search panel |
| `searchAndSelect(page, query, click?)` | Search and optionally click result |
| `waitForStreamingComplete(page)` | Wait for streaming to finish |
| `waitForAppReady(page)` | Wait for app header to be visible |

## Mocking Strategy

### NanoGPT API Mocking

Tests use Playwright's route interception to mock the NanoGPT streaming API:

```typescript
// Default mock (returns 'OK')
await mockNanoGPTStreaming(page)

// Custom tokens
await mockNanoGPTStreaming(page, {
  tokens: ['Hello', ', ', 'World!']
})

// Simulate error
await mockNanoGPTStreaming(page, {
  status: 401,
  errorBody: { error: { message: 'Invalid API key' } }
})

// Simulate delay (for testing loading states)
await mockNanoGPTStreaming(page, {
  tokens: ['Delayed response'],
  delay: 1000
})
```

### SSE Response Format

The mock creates properly formatted SSE (Server-Sent Events) responses:

```
data: {"id":"test-id","object":"chat.completion.chunk","created":1234567890,"model":"chatgpt-4o-latest","choices":[{"index":0,"delta":{"content":"token"},"finish_reason":null}]}

data: [DONE]
```

## Test Assumptions

### API Key
- Tests assume API key is stored at `localStorage['bonsai:nanogpt:apiKey']`
- `bootstrapApp()` sets a dummy key: `test-api-key-e2e-12345`
- Use `{ withApiKey: false }` to test without API key

### IndexedDB
- Database name: `BonsaiDB`
- Tests clear the database in `beforeEach` via `bootstrapApp()` or `resetAppState()`

### Encryption
- Encryption tests use `resetAppState()` directly (not `bootstrapApp()`)
- Encryption conflicts with API key setup since keys are encrypted
- Lock state is stored in memory, not persisted

### Service Worker
- Service worker may cache assets
- Tests clear state but don't unregister SW
- Use `await page.reload()` if cache issues occur

## Interaction Patterns

### Message Sending
**Decision:** Always use click on `[data-testid="send-btn"]` rather than keyboard shortcuts.

This is more reliable and consistent across all tests:
```typescript
await page.fill('[data-testid="composer-input"]', 'Message')
await page.click('[data-testid="send-btn"]')
```

### Data-testid Selectors
All tests use `data-testid` attributes for element selection:

```typescript
// Good - stable selector
await page.click('[data-testid="new-conversation-btn"]')

// Avoid - brittle text selector
await page.click('text=New Conversation')
```

Common testids:
- `app-header` - Main app header
- `new-conversation-btn` - Create conversation button
- `conversation-list` - Conversation list container
- `empty-state` - Empty state message
- `message-timeline` - Message timeline container
- `message-composer` - Composer component
- `composer-input` - Textarea for message input
- `send-btn` - Send message button
- `stop-btn` - Stop streaming button
- `error-banner` - Error message banner
- `back-btn` - Back navigation button

## Debugging Tips

### View Test Traces
```bash
# Generate traces on failure
npx playwright test --trace on

# View trace file
npx playwright show-trace test-results/path-to-trace.zip
```

### Debug Mode
```bash
# Run with inspector
PWDEBUG=1 npx playwright test

# Pause test at specific point
await page.pause()
```

### Screenshots
```bash
# Take screenshot during test
await page.screenshot({ path: 'debug.png' })
```

## CI/CD Integration

Tests run in CI with:
```bash
npm run test:e2e
```

The Playwright config (`playwright.config.ts`) sets:
- `retries: 2` in CI
- `workers: 1` for stability
- HTML reporter for results
- Automatic dev server startup

## Adding New Tests

1. Import helpers:
   ```typescript
   import { bootstrapApp, createConversation } from './helpers'
   ```

2. Use `bootstrapApp()` in `beforeEach`:
   ```typescript
   test.beforeEach(async ({ page }) => {
     await bootstrapApp(page)
   })
   ```

3. Use stable `data-testid` selectors

4. For new UI components, add `data-testid` attributes in the Vue component

5. If adding new mock scenarios, consider extending `helpers.ts`
