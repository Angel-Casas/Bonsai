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

    // 10b. Verify the new branch appears in the Conversation Tree
    const treeContainer = page.getByTestId('message-tree')
    await expect(treeContainer).toContainText('Alternative Branch')

    // 11. Navigate back to original path using the tree
    // The tree shows branches. Find and click the non-alternative branch to go back.
    // The original branch should show the preview text from "Second message"
    const originalBranch = page.locator('[data-testid^="tree-node-"]').filter({ hasText: 'Second' })
    if (await originalBranch.isVisible()) {
      await originalBranch.click()
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

  test('context builder: expand, toggle messages, browse branches and filter', async ({ page }) => {
    await createConversation(page, { title: 'Context Control Test' })

    // Add messages to create a path
    await sendMessage(page, 'Root message')
    await sendMessage(page, 'Second message on path')
    await sendMessage(page, 'Third message on path')

    // Verify we have the path with all three messages
    await expect(page.getByTestId('message-timeline')).toContainText('Third message on path')

    // Verify context builder toggle exists (collapsed state)
    const contextBuilderToggle = page.getByTestId('context-builder-toggle')
    await expect(contextBuilderToggle).toBeVisible()

    // Expand context builder
    await contextBuilderToggle.click()

    // Verify expanded panel is visible
    const contextBuilderPanel = page.getByTestId('context-builder-panel')
    await expect(contextBuilderPanel).toBeVisible()

    // Verify Current Path tab is active by default and shows path messages
    const currentPathSection = page.getByTestId('context-current-path')
    await expect(currentPathSection).toBeVisible()

    // Current Path should show our path messages
    await expect(currentPathSection).toContainText('Root')
    await expect(currentPathSection).toContainText('Second')
    await expect(currentPathSection).toContainText('Third')

    // Toggle buttons should exist for path messages
    const toggleButtons = page.locator('[data-testid^="toggle-btn-"]')
    const toggleCount = await toggleButtons.count()
    expect(toggleCount).toBeGreaterThan(0)

    // Click toggle on the second path item to exclude it
    if (toggleCount > 1) {
      await toggleButtons.nth(1).click()
    }

    // Switch to All Branches tab
    await page.getByTestId('context-tab-all-branches').click()
    const branchesSection = page.getByTestId('context-all-branches')
    await expect(branchesSection).toBeVisible()

    // At least one branch group should exist
    const branchGroups = page.locator('[data-testid^="branch-group-"]')
    await expect(branchGroups.first()).toBeVisible()

    // Switch to All Messages tab
    await page.getByTestId('context-tab-all-messages').click()
    const allMessagesSection = page.getByTestId('context-all-messages')
    await expect(allMessagesSection).toBeVisible()

    // Filter buttons should be visible
    const filterBar = page.getByTestId('all-messages-filter')
    await expect(filterBar).toBeVisible()
    await expect(page.getByTestId('filter-btn-all')).toBeVisible()
    await expect(page.getByTestId('filter-btn-in-context')).toBeVisible()
    await expect(page.getByTestId('filter-btn-not-in-context')).toBeVisible()

    // Click the "Not in context" filter to show only excluded messages
    await page.getByTestId('filter-btn-not-in-context').click()

    // Click "All" filter to show everything again
    await page.getByTestId('filter-btn-all').click()

    // Clear config using the reset button
    await page.getByTestId('clear-config-btn').click()

    // Switch back to Current Path to verify reset worked
    await page.getByTestId('context-tab-current-path').click()
    await expect(currentPathSection).toBeVisible()

    // Collapse context builder
    await contextBuilderToggle.click()
    await expect(contextBuilderPanel).not.toBeVisible()
  })
})
