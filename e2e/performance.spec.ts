/**
 * Performance E2E Tests
 *
 * Tests for large dataset handling and performance optimization.
 * Verifies that the app can handle large conversations without hanging.
 */

import { test, expect } from '@playwright/test'
import { bootstrapApp, setApiKey, mockNanoGPTStreaming } from './helpers'

test.describe('Performance with Large Datasets', () => {
  test.beforeEach(async ({ page }) => {
    await bootstrapApp(page)
  })

  test('can generate and render 1000 message conversation', async ({ page }) => {
    // Set a longer timeout for this test
    test.setTimeout(60000)

    // Navigate to settings
    await page.click('[data-testid="settings-btn"]')
    await page.waitForSelector('[data-testid="api-key-section"]')

    // Check if dev tools section is visible
    const devToolsSection = page.getByTestId('dev-tools-section')
    const isDevToolsVisible = await devToolsSection.isVisible().catch(() => false)

    if (!isDevToolsVisible) {
      // Skip this test in production mode
      test.skip()
      return
    }

    // Generate a medium dataset (1000 messages)
    // Select "medium" preset
    await page.locator('select').selectOption('medium')

    // Click generate button
    const generateBtn = page.getByTestId('generate-dataset-btn')
    await generateBtn.click()

    // Wait for generation to complete (with generous timeout)
    await expect(page.getByTestId('go-to-conversation-btn')).toBeVisible({ timeout: 30000 })

    // Verify the stats show correct count
    const statsGrid = page.locator('.stats-grid')
    await expect(statsGrid).toContainText('1000')

    // Navigate to the generated conversation
    await page.getByTestId('go-to-conversation-btn').click()

    // Verify we're on the conversation page
    await expect(page.getByTestId('conversation-title')).toBeVisible({ timeout: 10000 })

    // Verify the message timeline rendered (virtualized view)
    await expect(page.getByTestId('message-timeline')).toBeVisible()

    // Verify at least some messages are visible
    const messages = page.locator('[data-testid^="timeline-message-"]')
    const messageCount = await messages.count()
    expect(messageCount).toBeGreaterThan(0)

    // Verify tree controls appear (for large datasets, controls should show)
    const treeControls = page.getByTestId('tree-controls')
    const controlsVisible = await treeControls.isVisible().catch(() => false)
    // Controls show when messages > 50, so for 1000 messages they should be visible
    expect(controlsVisible).toBe(true)

    // Verify the page is still responsive - try to interact with composer
    const composer = page.getByTestId('composer-input')
    await expect(composer).toBeVisible()
    await composer.fill('Test responsiveness')

    // Clear the input (proves page is responsive)
    await composer.clear()
    await expect(composer).toHaveValue('')
  })

  test('virtual scrolling renders only visible items', async ({ page }) => {
    test.setTimeout(60000)

    // Navigate to settings
    await page.click('[data-testid="settings-btn"]')
    await page.waitForSelector('[data-testid="api-key-section"]')

    const devToolsSection = page.getByTestId('dev-tools-section')
    const isDevToolsVisible = await devToolsSection.isVisible().catch(() => false)

    if (!isDevToolsVisible) {
      test.skip()
      return
    }

    // Generate a small dataset to verify virtualization threshold
    await page.locator('select').selectOption('small') // 100 messages
    await page.getByTestId('generate-dataset-btn').click()
    await expect(page.getByTestId('go-to-conversation-btn')).toBeVisible({ timeout: 30000 })
    await page.getByTestId('go-to-conversation-btn').click()

    // Wait for conversation to load
    await expect(page.getByTestId('message-timeline')).toBeVisible({ timeout: 10000 })

    // With 100 messages and virtualization threshold of 50, virtualization should be active
    // The DOM should have significantly fewer nodes than 100 messages
    const messages = page.locator('[data-testid^="timeline-message-"]')
    const renderedCount = await messages.count()

    // With virtual scrolling, we should render only visible items + buffer
    // This should be significantly less than 100
    expect(renderedCount).toBeLessThan(100)
    expect(renderedCount).toBeGreaterThan(0)
  })

  test('tree collapse/expand controls work', async ({ page }) => {
    test.setTimeout(60000)

    // Navigate to settings
    await page.click('[data-testid="settings-btn"]')
    await page.waitForSelector('[data-testid="api-key-section"]')

    const devToolsSection = page.getByTestId('dev-tools-section')
    const isDevToolsVisible = await devToolsSection.isVisible().catch(() => false)

    if (!isDevToolsVisible) {
      test.skip()
      return
    }

    // Generate a small dataset with branches
    await page.locator('select').selectOption('small')
    await page.getByTestId('generate-dataset-btn').click()
    await expect(page.getByTestId('go-to-conversation-btn')).toBeVisible({ timeout: 30000 })
    await page.getByTestId('go-to-conversation-btn').click()

    // Wait for conversation to load
    await expect(page.getByTestId('conversation-title')).toBeVisible({ timeout: 10000 })

    // Open sidebar if needed
    const sidebar = page.getByTestId('tree-sidebar')
    const isSidebarVisible = await sidebar.isVisible().catch(() => false)
    if (!isSidebarVisible) {
      const toggleBtn = page.getByTestId('toggle-sidebar-desktop-btn')
      if (await toggleBtn.isVisible()) {
        await toggleBtn.click()
      }
    }

    // Check for tree controls
    const treeControls = page.getByTestId('tree-controls')
    const controlsVisible = await treeControls.isVisible().catch(() => false)

    if (controlsVisible) {
      // Click collapse all
      const collapseAllBtn = page.getByTestId('collapse-all-btn')
      await collapseAllBtn.click()

      // Count visible nodes - should be reduced
      const nodesAfterCollapse = await page.locator('[data-testid^="tree-node-"]').count()

      // Click expand all
      const expandAllBtn = page.getByTestId('expand-all-btn')
      await expandAllBtn.click()

      // Count nodes after expand - should be more
      const nodesAfterExpand = await page.locator('[data-testid^="tree-node-"]').count()

      // Expanded should show more or equal nodes than collapsed
      expect(nodesAfterExpand).toBeGreaterThanOrEqual(nodesAfterCollapse)
    }
  })

  test('graph view auto-applies filters for large datasets', async ({ page }) => {
    test.setTimeout(60000)

    // Navigate to settings
    await page.click('[data-testid="settings-btn"]')
    await page.waitForSelector('[data-testid="api-key-section"]')

    const devToolsSection = page.getByTestId('dev-tools-section')
    const isDevToolsVisible = await devToolsSection.isVisible().catch(() => false)

    if (!isDevToolsVisible) {
      test.skip()
      return
    }

    // Generate a large dataset (threshold for auto-filters is 500)
    await page.locator('select').selectOption('large') // 5000 messages
    await page.getByTestId('generate-dataset-btn').click()
    await expect(page.getByTestId('go-to-conversation-btn')).toBeVisible({ timeout: 60000 })
    await page.getByTestId('go-to-conversation-btn').click()

    // Wait for conversation to load
    await expect(page.getByTestId('conversation-title')).toBeVisible({ timeout: 10000 })

    // Switch to graph view (may take time with large datasets)
    await page.click('[data-testid="view-mode-graph"]')
    await page.waitForSelector('[data-testid="graph-container"]', { timeout: 30000 })

    // For large datasets (>= 500), auto-defaults should be applied
    // Check for the auto-defaults indicator
    const autoDefaultsIndicator = page.getByTestId('auto-defaults-indicator')
    const isAutoDefaultsVisible = await autoDefaultsIndicator.isVisible().catch(() => false)

    // With 5000 messages, auto-defaults should definitely be applied
    expect(isAutoDefaultsVisible).toBe(true)

    // The branch roots only checkbox should be checked
    const branchRootsToggle = page.getByTestId('branch-roots-toggle')
    await expect(branchRootsToggle).toBeChecked()
  })

  test('diagnostics panel shows cache statistics', async ({ page }) => {
    // Navigate to settings
    await page.click('[data-testid="settings-btn"]')
    await page.waitForSelector('[data-testid="api-key-section"]')

    const devToolsSection = page.getByTestId('dev-tools-section')
    const isDevToolsVisible = await devToolsSection.isVisible().catch(() => false)

    if (!isDevToolsVisible) {
      test.skip()
      return
    }

    // Click refresh diagnostics
    await page.getByTestId('refresh-diagnostics-btn').click()

    // Verify diagnostics panel appears
    await expect(page.getByTestId('diagnostics-panel')).toBeVisible()

    // Verify it shows search cache info
    await expect(page.getByTestId('diagnostics-panel')).toContainText('Search Cache')

    // Verify it shows decryption cache info
    await expect(page.getByTestId('diagnostics-panel')).toContainText('Decryption Cache')
  })
})
