/**
 * E2E tests for Graph View (Milestone 8)
 *
 * Tests the graph visualization feature:
 * - View mode toggle (Tree/Split/Graph)
 * - Canvas-based graph rendering
 * - Density controls
 * - URL persistence
 *
 * Note: Since we use Canvas (not SVG), we can't directly select/click
 * individual nodes. Tests focus on control interactions and URL updates.
 */

import { test, expect } from '@playwright/test'
import {
  bootstrapApp,
  createConversation,
  sendMessage,
  setViewMode,
} from './helpers'

test.describe('Graph View', () => {
  test.beforeEach(async ({ page }) => {
    await bootstrapApp(page)
  })

  test('view mode toggle shows Tree, Split, and Graph options', async ({ page }) => {
    await createConversation(page, { title: 'Graph Test' })

    // Check view mode toggle exists with all three options
    const viewModeToggle = page.getByTestId('view-mode-toggle')
    await expect(viewModeToggle).toBeVisible()

    await expect(page.getByTestId('view-mode-tree')).toBeVisible()
    await expect(page.getByTestId('view-mode-split')).toBeVisible()
    await expect(page.getByTestId('view-mode-graph')).toBeVisible()

    // Tree should be active by default
    await expect(page.getByTestId('view-mode-tree')).toHaveClass(/active/)
  })

  test('switching to graph view and back', async ({ page }) => {
    await createConversation(page, { title: 'Graph Switch Test' })

    // Add a message
    await sendMessage(page, 'Test message')

    // Switch to graph view
    await setViewMode(page, 'graph')

    // Graph container should be visible
    await expect(page.getByTestId('graph-container')).toBeVisible()

    // Graph button should be active
    await expect(page.getByTestId('view-mode-graph')).toHaveClass(/active/)

    // URL should update
    await expect(page).toHaveURL(/view=graph/)

    // Switch back to tree view
    await setViewMode(page, 'tree')

    // Graph should be hidden, timeline visible
    await expect(page.getByTestId('graph-view-container')).not.toBeVisible()
    await expect(page.getByTestId('message-timeline')).toBeVisible()
  })

  test('graph view shows canvas for messages', async ({ page }) => {
    await createConversation(page, { title: 'Graph Canvas Test' })

    // Add a message
    await sendMessage(page, 'Graph canvas test')

    // Switch to graph view
    await setViewMode(page, 'graph')

    // Graph canvas should be visible
    const graphCanvas = page.getByTestId('graph-canvas')
    await expect(graphCanvas).toBeVisible()

    // Canvas should have proper dimensions
    const boundingBox = await graphCanvas.boundingBox()
    expect(boundingBox?.width).toBeGreaterThan(100)
    expect(boundingBox?.height).toBeGreaterThan(100)
  })

  test('graph view URL persistence on reload', async ({ page }) => {
    await createConversation(page, { title: 'Persistence Test' })

    // Add a message
    await sendMessage(page, 'Persistence message')

    // Switch to graph view
    await setViewMode(page, 'graph')
    await expect(page).toHaveURL(/view=graph/)

    // Reload the page
    await page.reload()

    // Graph view should still be active
    await expect(page.getByTestId('graph-view-container')).toBeVisible()
    await expect(page.getByTestId('view-mode-graph')).toHaveClass(/active/)
  })

  test('graph view density controls exist and work', async ({ page }) => {
    await createConversation(page, { title: 'Density Test' })

    // Add a message
    await sendMessage(page, 'Density message')

    // Switch to graph view
    await setViewMode(page, 'graph')

    // Compact toggle should exist
    const compactToggle = page.getByTestId('compact-nodes-toggle')
    await expect(compactToggle).toBeVisible()

    // Highlight path toggle should exist
    const highlightToggle = page.getByTestId('highlight-path-toggle')
    await expect(highlightToggle).toBeVisible()

    // Test compact toggle (may be checked by default)
    const isCompactChecked = await compactToggle.isChecked()
    await compactToggle.click()
    await expect(compactToggle).toBeChecked({ checked: !isCompactChecked })

    // Test highlight path toggle
    const isHighlightChecked = await highlightToggle.isChecked()
    await highlightToggle.click()
    await expect(highlightToggle).toBeChecked({ checked: !isHighlightChecked })
  })

  test('graph view control buttons work', async ({ page }) => {
    await createConversation(page, { title: 'Controls Test' })

    // Add multiple messages
    await sendMessage(page, 'First message')
    await sendMessage(page, 'Second message')

    // Switch to graph view
    await setViewMode(page, 'graph')

    // Canvas should be visible
    await expect(page.getByTestId('graph-canvas')).toBeVisible()

    // Center button should exist and be clickable (fits all nodes in view)
    const centerButton = page.locator('button', { hasText: 'Center' })
    await expect(centerButton).toBeVisible()
    await centerButton.click()
  })

  test('graph view shows node count', async ({ page }) => {
    await createConversation(page, { title: 'Node Count Test' })

    // Add messages
    await sendMessage(page, 'First message')
    await sendMessage(page, 'Second message')

    // Switch to graph view
    await setViewMode(page, 'graph')

    // Should show node count in the controls
    const nodeCount = page.locator('.node-count')
    await expect(nodeCount).toBeVisible()

    // Should show at least 2 nodes (our 2 messages + any assistant responses)
    const nodeCountText = await nodeCount.textContent()
    const count = parseInt(nodeCountText?.match(/\d+/)?.[0] ?? '0', 10)
    expect(count).toBeGreaterThanOrEqual(2)
  })

  test('pan interaction works via mouse drag', async ({ page }) => {
    await createConversation(page, { title: 'Pan Test' })

    // Add a message
    await sendMessage(page, 'Pan test message')

    // Switch to graph view
    await setViewMode(page, 'graph')

    const canvas = page.getByTestId('graph-canvas')
    await expect(canvas).toBeVisible()

    // Get canvas bounding box
    const box = await canvas.boundingBox()
    if (!box) return

    // Perform drag operation
    const startX = box.x + box.width / 2
    const startY = box.y + box.height / 2

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + 100, startY + 50)
    await page.mouse.up()

    // Canvas should still be visible (pan worked without errors)
    await expect(canvas).toBeVisible()
  })

  test('zoom interaction works via mouse wheel', async ({ page }) => {
    await createConversation(page, { title: 'Zoom Test' })

    // Add a message
    await sendMessage(page, 'Zoom test message')

    // Switch to graph view
    await setViewMode(page, 'graph')

    const canvas = page.getByTestId('graph-canvas')
    await expect(canvas).toBeVisible()

    // Get canvas bounding box
    const box = await canvas.boundingBox()
    if (!box) return

    // Perform zoom via wheel
    const centerX = box.x + box.width / 2
    const centerY = box.y + box.height / 2

    await page.mouse.move(centerX, centerY)
    await page.mouse.wheel(0, -100) // Zoom in

    // Canvas should still be visible (zoom worked without errors)
    await expect(canvas).toBeVisible()
  })
})
