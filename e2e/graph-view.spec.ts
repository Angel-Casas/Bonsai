/**
 * E2E tests for Graph View (Milestone 8)
 *
 * Tests the graph visualization feature:
 * - View mode toggle (Tree/Split/Graph)
 * - Graph rendering with nodes and edges
 * - Node click navigation
 * - Density controls
 * - URL persistence
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

  test('graph view shows nodes for messages', async ({ page }) => {
    await createConversation(page, { title: 'Graph Nodes Test' })

    // Add a message
    await sendMessage(page, 'Graph node test')

    // Switch to graph view
    await setViewMode(page, 'graph')

    // Graph SVG should be visible with at least one node
    const graphSvg = page.getByTestId('graph-svg')
    await expect(graphSvg).toBeVisible()

    // Should have at least one node circle
    const nodeCount = await graphSvg.locator('g.nodes > g').count()
    expect(nodeCount).toBeGreaterThan(0)
  })

  test('clicking a node in graph view updates URL', async ({ page }) => {
    await createConversation(page, { title: 'Graph Click Test' })

    // Add messages
    await sendMessage(page, 'First message')
    await sendMessage(page, 'Second message')

    // Switch to graph view
    await setViewMode(page, 'graph')

    // Wait for graph to render
    const graphSvg = page.getByTestId('graph-svg')
    await expect(graphSvg).toBeVisible()

    // Get the first node and click it
    const firstNode = graphSvg.locator('g.nodes > g').first()
    await firstNode.click()

    // URL should update with message parameter
    await expect(page).toHaveURL(/message=/)
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

  test('graph view density controls exist', async ({ page }) => {
    await createConversation(page, { title: 'Density Test' })

    // Add a message
    await sendMessage(page, 'Density message')

    // Switch to graph view
    await setViewMode(page, 'graph')

    // Branch roots toggle should exist
    const branchRootsToggle = page.getByTestId('branch-roots-toggle')
    await expect(branchRootsToggle).toBeVisible()

    // Depth limit select should exist
    const depthSelect = page.getByTestId('depth-limit-select')
    await expect(depthSelect).toBeVisible()

    // Test branch roots toggle
    await branchRootsToggle.click()
    await expect(branchRootsToggle).toBeChecked()

    // Test depth limit select
    await depthSelect.selectOption('3')
    await expect(depthSelect).toHaveValue('3')
  })

  test('node tooltip shows on hover', async ({ page }) => {
    await createConversation(page, { title: 'Tooltip Test' })

    // Add a message
    await sendMessage(page, 'Tooltip message')

    // Switch to graph view
    await setViewMode(page, 'graph')
    await expect(page.getByTestId('graph-svg')).toBeVisible()

    // Hover over a node
    const node = page.locator('[data-testid="graph-svg"] g.nodes > g').first()
    await node.hover()

    // Tooltip should appear and contain a role (user or assistant)
    const tooltip = page.getByTestId('graph-tooltip')
    await expect(tooltip).toBeVisible()
    const tooltipText = await tooltip.textContent()
    expect(tooltipText).toMatch(/user|assistant/)
  })
})
