import { test, expect } from '@playwright/test'
import {
  bootstrapApp,
  createConversation,
  sendMessage,
  createBranchFromMessage,
} from './helpers'

test.describe('Conversation Branching E2E', () => {
  test.beforeEach(async ({ page }) => {
    await bootstrapApp(page)
  })

  test('full branching workflow: create conversation, add messages, branch, navigate', async ({
    page,
  }) => {
    // 1. Verify home page loads
    await expect(page.getByTestId('app-header')).toContainText('Bonsai')
    await expect(page.getByTestId('empty-state')).toBeVisible()

    // 2. Create a new conversation
    await createConversation(page, { title: 'Test Conversation' })

    // 3. Verify we're on the conversation page
    await expect(page.getByTestId('conversation-title')).toHaveText('Test Conversation')
    await expect(page.getByTestId('message-composer')).toBeVisible()

    // 4. Add first user message
    await sendMessage(page, 'First message')
    await expect(page.getByTestId('message-timeline')).toContainText('First message')

    // 5. Add second user message
    await sendMessage(page, 'Second message')
    await expect(page.getByTestId('message-timeline')).toContainText('Second message')

    // 6. Add third user message
    await sendMessage(page, 'Third message')
    await expect(page.getByTestId('message-timeline')).toContainText('Third message')

    // 7. Verify tree has all messages
    const sidebar = page.getByTestId('tree-sidebar')
    const isSidebarVisible = await sidebar.isVisible().catch(() => false)
    if (!isSidebarVisible) {
      const toggleBtn = page.getByTestId('toggle-sidebar-desktop-btn')
      if (await toggleBtn.isVisible()) {
        await toggleBtn.click()
      }
    }
    await expect(page.getByTestId('message-tree')).toBeVisible()

    // 8. Branch from the first message
    await createBranchFromMessage(page, 0, {
      branchTitle: 'Alternative Branch',
      content: 'Branched message content',
    })

    // 9. Verify we're now on the new branch
    await expect(page.getByTestId('message-timeline')).toContainText('Branched message content')
    await expect(page.getByTestId('message-timeline')).not.toContainText('Second message')
    await expect(page.getByTestId('message-timeline')).not.toContainText('Third message')

    // 10. Verify branch title shows in timeline
    await expect(page.getByTestId('message-timeline')).toContainText('Alternative Branch')

    // 11. Navigate back to original path using the tree
    const thirdMsgNode = page.locator('[data-testid^="tree-node-"]').filter({ hasText: 'Third message' })
    if (await thirdMsgNode.isVisible()) {
      await thirdMsgNode.click()
      await expect(page.getByTestId('message-timeline')).toContainText('Third message')
      await expect(page.getByTestId('message-timeline')).toContainText('Second message')
    }

    // 12. Go back to home and verify conversation exists
    await page.getByTestId('back-btn').click()
    await expect(page.getByTestId('app-header')).toContainText('Bonsai')
    await expect(page.getByTestId('conversation-list')).toBeVisible()
    await expect(page.getByText('Test Conversation')).toBeVisible()
  })

  test('can rename and delete a conversation', async ({ page }) => {
    // Create a conversation
    await createConversation(page, { title: 'To Be Renamed' })

    // Go back to home
    await page.getByTestId('back-btn').click()
    await expect(page.getByText('To Be Renamed')).toBeVisible()

    // Hover to show edit button and click it
    const conversationItem = page.locator('[data-testid^="conversation-item-"]').first()
    await conversationItem.hover()

    const editBtn = conversationItem.locator('[data-testid^="edit-btn-"]')
    await editBtn.click()

    // Rename
    await page.getByTestId('edit-title-input').clear()
    await page.getByTestId('edit-title-input').fill('Renamed Conversation')
    await page.getByTestId('save-edit-btn').click()

    // Verify renamed
    await expect(page.getByText('Renamed Conversation')).toBeVisible()
    await expect(page.getByText('To Be Renamed')).not.toBeVisible()

    // Delete the conversation
    await conversationItem.hover()
    const deleteBtn = conversationItem.locator('[data-testid^="delete-btn-"]')
    await deleteBtn.click()

    // Confirm deletion
    await page.getByTestId('confirm-delete-btn').click()

    // Verify deleted
    await expect(page.getByTestId('empty-state')).toBeVisible()
    await expect(page.getByText('Renamed Conversation')).not.toBeVisible()
  })

  test('breadcrumbs show current path and allow navigation', async ({ page }) => {
    // Create a conversation with multiple messages
    await createConversation(page, { title: 'Breadcrumb Test' })

    // Add messages
    await sendMessage(page, 'Message 1')
    await sendMessage(page, 'Message 2')
    await sendMessage(page, 'Message 3')

    // Verify breadcrumbs exist
    await expect(page.getByTestId('path-breadcrumbs')).toBeVisible()

    // Click on a breadcrumb to navigate
    const breadcrumbs = page.locator('[data-testid^="breadcrumb-"]')
    const firstBreadcrumb = breadcrumbs.first()
    await firstBreadcrumb.click()

    // Verify the breadcrumbs still work without error
    await expect(page.getByTestId('path-breadcrumbs')).toBeVisible()
  })

  test('context builder: expand, view preview, exclude, and pin messages', async ({ page }) => {
    await createConversation(page, { title: 'Context Control Test' })

    // Add messages to create a path
    await sendMessage(page, 'Root message')
    await sendMessage(page, 'Second message on path')
    await sendMessage(page, 'Third message on path')

    // Create a branch from root message (first user message, index 0)
    await createBranchFromMessage(page, 0, { content: 'Alternate branch message' })

    // Navigate back to third message via tree
    const toggleBtn = page.getByTestId('toggle-sidebar-desktop-btn')
    if (await toggleBtn.isVisible()) {
      await toggleBtn.click()
    }

    // Find and click the third message node in tree
    const thirdMsgNode = page.locator('[data-testid^="tree-node-"]').filter({ hasText: 'Third message' })
    await expect(thirdMsgNode).toBeVisible({ timeout: 5000 })
    await thirdMsgNode.click()

    // Verify we're on the path with third message
    await expect(page.getByTestId('message-timeline')).toContainText('Third message on path')

    // Verify context builder toggle exists (collapsed state)
    const contextBuilderToggle = page.getByTestId('context-builder-toggle')
    await expect(contextBuilderToggle).toBeVisible()

    // Expand context builder
    await contextBuilderToggle.click()

    // Verify expanded panel is visible
    const contextBuilderPanel = page.getByTestId('context-builder-panel')
    await expect(contextBuilderPanel).toBeVisible()

    // Verify preview tab is active by default and shows path messages
    const previewSection = page.getByTestId('context-preview')
    await expect(previewSection).toBeVisible()

    // Preview should show our path messages (checking partial content is in the section)
    await expect(previewSection).toContainText('Root')
    await expect(previewSection).toContainText('Second')
    await expect(previewSection).toContainText('Third')

    // Switch to Path tab to test exclusion
    await page.getByTestId('context-tab-path').click()
    const pathConfig = page.getByTestId('context-path-config')
    await expect(pathConfig).toBeVisible()

    // Find and click an exclude button for the second message
    const excludeButtons = page.locator('[data-testid^="exclude-btn-"]')
    const excludeCount = await excludeButtons.count()
    expect(excludeCount).toBeGreaterThan(0)

    // Click exclude on the second path item (index 1)
    if (excludeCount > 1) {
      await excludeButtons.nth(1).click()
    }

    // Switch back to preview to verify exclusion took effect
    await page.getByTestId('context-tab-preview').click()
    await expect(previewSection).toBeVisible()

    // Switch to Pins tab
    await page.getByTestId('context-tab-pins').click()
    const pinsConfig = page.getByTestId('context-pins-config')
    await expect(pinsConfig).toBeVisible()

    // Search for the alternate branch message
    const pinSearchInput = page.getByTestId('pin-search-input')
    await expect(pinSearchInput).toBeVisible()
    await pinSearchInput.fill('Alternate')

    // Wait for search results and click to pin
    const pinResult = page.locator('[data-testid^="pin-result-"]').first()
    await expect(pinResult).toBeVisible({ timeout: 3000 })
    await pinResult.click()

    // Verify pinned item appears
    const pinnedItem = page.locator('[data-testid^="pinned-item-"]').first()
    await expect(pinnedItem).toBeVisible()

    // Clear config using the reset button
    await page.getByTestId('clear-config-btn').click()

    // Collapse context builder
    await contextBuilderToggle.click()
    await expect(contextBuilderPanel).not.toBeVisible()
  })
})
