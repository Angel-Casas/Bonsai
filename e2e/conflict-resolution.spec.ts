/**
 * E2E Tests for Conflict Resolution Flow
 *
 * Strategy: Since the ConflictResolver component only renders when the
 * `pendingConflicts` ref (from useSync) is non-empty, and triggering real
 * sync conflicts requires a running server plus two devices, these tests
 * use page.evaluate() to inject fake conflicts into the Vue reactive state
 * via the __vue_app__ internal on the root DOM element.
 *
 * The tests verify:
 * - The ConflictResolver overlay appears when conflicts are present
 * - Resolution buttons (Keep mine, Keep theirs, Keep both) work
 * - Navigation between multiple conflicts works
 * - The Done button is disabled until all conflicts have a resolution
 * - The overlay disappears after resolution
 */

import { test, expect } from '@playwright/test'
import { bootstrapApp } from './helpers'

// ---------------------------------------------------------------------------
// Helpers: conflict data factories
// ---------------------------------------------------------------------------

/**
 * Builds a minimal ConflictPair that the ConflictResolver component accepts.
 * The local SyncOp payload and remote encryptedPayload are base64/JSON so that
 * the component's decode helpers produce readable previews.
 */
function makeConflictPair(
  type: 'edit-vs-edit' | 'edit-vs-delete' | 'rename-vs-rename' | 'rename-vs-delete' | 'create-vs-delete' = 'edit-vs-edit',
  index = 0,
) {
  const localContent = type.startsWith('rename')
    ? { title: `Local title ${index}` }
    : { content: `Local content ${index}` }

  const remoteContent = type.startsWith('rename')
    ? { title: `Remote title ${index}` }
    : { content: `Remote content ${index}` }

  return {
    remote: {
      id: `remote-op-${index}`,
      clientId: 'other-device',
      encryptedPayload: btoa(JSON.stringify(remoteContent)),
      conversationId: `conv-${index}`,
      createdAt: new Date().toISOString(),
    },
    local: {
      id: `local-op-${index}`,
      createdAt: new Date().toISOString(),
      conversationId: `conv-${index}`,
      type: 'message.edit' as const,
      payload: JSON.stringify(localContent),
      status: 'pending' as const,
      clientId: 'this-device',
      schemaVersion: 1,
    },
    type,
  }
}

// ---------------------------------------------------------------------------
// Helper: inject conflicts into the running Vue app
// ---------------------------------------------------------------------------

/**
 * Walks the Vue 3 internal component tree starting from the root __vue_app__
 * to find the `pendingConflicts` ref exposed by useSync() in App.vue, then
 * sets its value to the provided conflicts array.
 *
 * This relies on Vue 3 internals (__vue_app__, component.subTree, etc.) which
 * may change across Vue versions. If the injection fails, the test is skipped
 * with a descriptive message.
 */
async function injectConflicts(
  page: import('@playwright/test').Page,
  conflicts: ReturnType<typeof makeConflictPair>[],
): Promise<boolean> {
  return page.evaluate((conflictsData) => {
    // Access the Vue app instance mounted on #app
    const appEl = document.getElementById('app') as any
    if (!appEl?.__vue_app__) return false

    const app = appEl.__vue_app__

    // The root component instance is stored in _instance on the app's _context
    // or we can walk the vnode tree.
    // In Vue 3, the mounted app's root component is at app._instance
    const rootInstance = app._instance
    if (!rootInstance) return false

    // The App.vue setup function returns { pendingConflicts, resolveConflicts, ... }
    // These are available on the component's setupState (accessible via the proxy).
    const setupState = rootInstance.setupState
    if (!setupState) return false

    // Try direct access to pendingConflicts
    if (setupState.pendingConflicts !== undefined) {
      // pendingConflicts is a ref, so .value is the actual array
      // However, through the proxy, Vue unwraps refs automatically
      // We need to set the .value of the underlying ref
      const raw = (rootInstance as any).setupState
      // Use the internal refs directly from the setup scope
      // In Vue 3, setupState proxies refs so assignment goes through the setter
      raw.pendingConflicts = conflictsData
      return true
    }

    return false
  }, conflicts)
}

/**
 * Clears conflicts by setting pendingConflicts to an empty array.
 */
async function clearConflicts(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    const appEl = document.getElementById('app') as any
    if (!appEl?.__vue_app__?._instance?.setupState) return false
    appEl.__vue_app__._instance.setupState.pendingConflicts = []
    return true
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Conflict Resolution E2E', () => {
  test.beforeEach(async ({ page }) => {
    await bootstrapApp(page)
  })

  test('conflict resolver overlay appears when conflicts are injected', async ({ page }) => {
    // Verify no conflict resolver is visible initially
    await expect(page.getByTestId('conflict-resolver')).not.toBeVisible()

    // Inject a single edit-vs-edit conflict
    const conflicts = [makeConflictPair('edit-vs-edit', 0)]
    const injected = await injectConflicts(page, conflicts)

    if (!injected) {
      // If Vue internals are inaccessible, skip gracefully
      test.skip()
      return
    }

    // The ConflictResolver overlay should now be visible
    await expect(page.getByTestId('conflict-resolver')).toBeVisible({ timeout: 3000 })

    // Verify it shows "Conflict 1 of 1"
    await expect(page.getByTestId('conflict-resolver')).toContainText('Conflict 1 of 1')

    // Verify heading shows edit conflict type
    await expect(page.getByTestId('conflict-resolver')).toContainText('Edit conflict')
  })

  test('single conflict: select Keep Mine, click Done, overlay closes', async ({ page }) => {
    const conflicts = [makeConflictPair('edit-vs-edit', 0)]
    const injected = await injectConflicts(page, conflicts)
    if (!injected) { test.skip(); return }

    await expect(page.getByTestId('conflict-resolver')).toBeVisible({ timeout: 3000 })

    // Done button should be disabled before choosing a resolution
    await expect(page.getByTestId('conflict-done-btn')).toBeDisabled()

    // Click "Keep mine"
    await page.getByTestId('keep-local-btn').click()

    // The button should show selected state
    const keepLocalBtn = page.getByTestId('keep-local-btn')
    await expect(keepLocalBtn).toHaveClass(/selected/)

    // Done button should now be enabled
    await expect(page.getByTestId('conflict-done-btn')).toBeEnabled()

    // Click Done
    await page.getByTestId('conflict-done-btn').click()

    // Overlay should disappear (resolveConflicts clears pendingConflicts)
    await expect(page.getByTestId('conflict-resolver')).not.toBeVisible({ timeout: 3000 })
  })

  test('single conflict: select Keep Theirs, click Done', async ({ page }) => {
    const conflicts = [makeConflictPair('edit-vs-edit', 0)]
    const injected = await injectConflicts(page, conflicts)
    if (!injected) { test.skip(); return }

    await expect(page.getByTestId('conflict-resolver')).toBeVisible({ timeout: 3000 })

    // Click "Keep theirs"
    await page.getByTestId('keep-remote-btn').click()
    await expect(page.getByTestId('keep-remote-btn')).toHaveClass(/selected/)

    // Done should be enabled
    await expect(page.getByTestId('conflict-done-btn')).toBeEnabled()

    // Click Done
    await page.getByTestId('conflict-done-btn').click()
    await expect(page.getByTestId('conflict-resolver')).not.toBeVisible({ timeout: 3000 })
  })

  test('edit-vs-edit conflict shows Keep Both button', async ({ page }) => {
    const conflicts = [makeConflictPair('edit-vs-edit', 0)]
    const injected = await injectConflicts(page, conflicts)
    if (!injected) { test.skip(); return }

    await expect(page.getByTestId('conflict-resolver')).toBeVisible({ timeout: 3000 })

    // Keep Both should be visible for edit-vs-edit
    await expect(page.getByTestId('keep-both-btn')).toBeVisible()

    // Click Keep Both and verify it's selected
    await page.getByTestId('keep-both-btn').click()
    await expect(page.getByTestId('keep-both-btn')).toHaveClass(/selected/)

    // Done should be enabled
    await expect(page.getByTestId('conflict-done-btn')).toBeEnabled()

    await page.getByTestId('conflict-done-btn').click()
    await expect(page.getByTestId('conflict-resolver')).not.toBeVisible({ timeout: 3000 })
  })

  test('delete-type conflict hides Keep Both button', async ({ page }) => {
    const conflicts = [makeConflictPair('edit-vs-delete', 0)]
    const injected = await injectConflicts(page, conflicts)
    if (!injected) { test.skip(); return }

    await expect(page.getByTestId('conflict-resolver')).toBeVisible({ timeout: 3000 })

    // Verify the heading shows the delete conflict type
    await expect(page.getByTestId('conflict-resolver')).toContainText('Edit vs. delete conflict')

    // Keep Both should NOT be visible for delete conflicts
    await expect(page.getByTestId('keep-both-btn')).not.toBeVisible()

    // Keep mine and Keep theirs should still work
    await expect(page.getByTestId('keep-local-btn')).toBeVisible()
    await expect(page.getByTestId('keep-remote-btn')).toBeVisible()
  })

  test('multiple conflicts: navigate between them and resolve all', async ({ page }) => {
    const conflicts = [
      makeConflictPair('edit-vs-edit', 0),
      makeConflictPair('rename-vs-rename', 1),
    ]
    const injected = await injectConflicts(page, conflicts)
    if (!injected) { test.skip(); return }

    await expect(page.getByTestId('conflict-resolver')).toBeVisible({ timeout: 3000 })

    // Should show "Conflict 1 of 2"
    await expect(page.getByTestId('conflict-resolver')).toContainText('Conflict 1 of 2')
    await expect(page.getByTestId('conflict-resolver')).toContainText('Edit conflict')

    // Previous button should be disabled on the first conflict
    const prevBtn = page.locator('.conflict-nav .nav-btn').first()
    await expect(prevBtn).toBeDisabled()

    // Resolve the first conflict
    await page.getByTestId('keep-local-btn').click()

    // Navigate to the second conflict
    const nextBtn = page.locator('.conflict-nav .nav-btn').last()
    await nextBtn.click()

    // Should show "Conflict 2 of 2"
    await expect(page.getByTestId('conflict-resolver')).toContainText('Conflict 2 of 2')
    await expect(page.getByTestId('conflict-resolver')).toContainText('Rename conflict')

    // Next button should be disabled on the last conflict
    await expect(nextBtn).toBeDisabled()

    // Done should still be disabled (second conflict not resolved yet)
    await expect(page.getByTestId('conflict-done-btn')).toBeDisabled()

    // Resolve the second conflict
    await page.getByTestId('keep-remote-btn').click()

    // Done should now be enabled
    await expect(page.getByTestId('conflict-done-btn')).toBeEnabled()

    // Navigate back to verify first resolution is preserved
    await prevBtn.click()
    await expect(page.getByTestId('conflict-resolver')).toContainText('Conflict 1 of 2')
    await expect(page.getByTestId('keep-local-btn')).toHaveClass(/selected/)

    // Navigate forward again and click Done
    await nextBtn.click()
    await page.getByTestId('conflict-done-btn').click()

    // Overlay should disappear
    await expect(page.getByTestId('conflict-resolver')).not.toBeVisible({ timeout: 3000 })
  })

  test('changing resolution before clicking Done updates selection', async ({ page }) => {
    const conflicts = [makeConflictPair('edit-vs-edit', 0)]
    const injected = await injectConflicts(page, conflicts)
    if (!injected) { test.skip(); return }

    await expect(page.getByTestId('conflict-resolver')).toBeVisible({ timeout: 3000 })

    // Choose Keep mine first
    await page.getByTestId('keep-local-btn').click()
    await expect(page.getByTestId('keep-local-btn')).toHaveClass(/selected/)
    await expect(page.getByTestId('keep-remote-btn')).not.toHaveClass(/selected/)

    // Change to Keep theirs
    await page.getByTestId('keep-remote-btn').click()
    await expect(page.getByTestId('keep-remote-btn')).toHaveClass(/selected/)
    // Keep mine should no longer be selected (the Map stores one resolution per index)
    await expect(page.getByTestId('keep-local-btn')).not.toHaveClass(/selected/)

    // Change to Keep both
    await page.getByTestId('keep-both-btn').click()
    await expect(page.getByTestId('keep-both-btn')).toHaveClass(/selected/)
    await expect(page.getByTestId('keep-remote-btn')).not.toHaveClass(/selected/)

    // Done should be enabled and work
    await expect(page.getByTestId('conflict-done-btn')).toBeEnabled()
    await page.getByTestId('conflict-done-btn').click()
    await expect(page.getByTestId('conflict-resolver')).not.toBeVisible({ timeout: 3000 })
  })

  test('rename-vs-rename conflict shows side-by-side titles', async ({ page }) => {
    const conflicts = [makeConflictPair('rename-vs-rename', 0)]
    const injected = await injectConflicts(page, conflicts)
    if (!injected) { test.skip(); return }

    await expect(page.getByTestId('conflict-resolver')).toBeVisible({ timeout: 3000 })

    // Verify the rename conflict heading
    await expect(page.getByTestId('conflict-resolver')).toContainText('Rename conflict')

    // Verify side-by-side labels are present
    await expect(page.locator('.side-label').first()).toContainText('This device')
    await expect(page.locator('.side-label').last()).toContainText('Other device')

    // Verify local and remote titles are displayed
    await expect(page.getByTestId('conflict-resolver')).toContainText('Local title 0')
    await expect(page.getByTestId('conflict-resolver')).toContainText('Remote title 0')

    // Keep Both should be available for rename-vs-rename
    await expect(page.getByTestId('keep-both-btn')).toBeVisible()
  })

  test('edit-vs-edit conflict shows side-by-side content', async ({ page }) => {
    const conflicts = [makeConflictPair('edit-vs-edit', 0)]
    const injected = await injectConflicts(page, conflicts)
    if (!injected) { test.skip(); return }

    await expect(page.getByTestId('conflict-resolver')).toBeVisible({ timeout: 3000 })

    // Verify side-by-side labels
    await expect(page.locator('.side-label').first()).toContainText('This device')
    await expect(page.locator('.side-label').last()).toContainText('Other device')

    // Verify content previews
    await expect(page.getByTestId('conflict-resolver')).toContainText('Local content 0')
    await expect(page.getByTestId('conflict-resolver')).toContainText('Remote content 0')
  })

  test('edit-vs-delete conflict shows delete notice', async ({ page }) => {
    const conflicts = [makeConflictPair('edit-vs-delete', 0)]
    const injected = await injectConflicts(page, conflicts)
    if (!injected) { test.skip(); return }

    await expect(page.getByTestId('conflict-resolver')).toBeVisible({ timeout: 3000 })

    // Should show the delete notice message
    await expect(page.getByTestId('conflict-resolver')).toContainText(
      'You edited this, but it was deleted on another device'
    )

    // Should show the local change preview
    await expect(page.locator('.preview-label')).toContainText('Your local change')
  })
})

// ---------------------------------------------------------------------------
// TODO: Full integration E2E tests
// ---------------------------------------------------------------------------
// The tests above verify the ConflictResolver UI by injecting fake conflicts
// into the Vue reactive state. A full integration test would require:
//
// 1. A running sync server (backend)
// 2. Two authenticated browser sessions simulating two devices
// 3. Device A: create a conversation and send a message
// 4. Device B: edit the same message concurrently
// 5. Device A: trigger sync, verify ConflictResolver appears
// 6. Device A: resolve the conflict and verify the resolution is applied
//
// This would live in a separate e2e/sync-integration.spec.ts and would
// need the server docker container running alongside the Playwright tests.
// ---------------------------------------------------------------------------
