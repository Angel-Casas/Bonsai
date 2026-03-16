/**
 * E2E Tests for Export/Import functionality
 *
 * Strategy:
 * - Export downloads are mocked by intercepting the download
 * - Import file selection is triggered programmatically
 * - We verify UI state and database consistency
 */

import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import {
  bootstrapApp,
  createConversation,
  openSettings,
  waitForAppReady,
} from './helpers'

test.describe('Export/Import', () => {
  test.beforeEach(async ({ page }) => {
    await bootstrapApp(page, { withStreamingMock: false })
  })

  test('export button triggers download with valid JSON', async ({ page }) => {
    // Navigate directly to settings
    await openSettings(page)
    await page.waitForSelector('[data-testid="data-storage-section"]')

    // Click export button (opens format selection dialog)
    await page.click('[data-testid="export-all-btn"]')
    await page.waitForSelector('[data-testid="export-all-dialog"]')

    // Set up download listener and confirm export (JSON format is default)
    const downloadPromise = page.waitForEvent('download')
    await page.click('[data-testid="confirm-export-all-btn"]')
    const download = await downloadPromise

    // Verify filename pattern
    expect(download.suggestedFilename()).toMatch(/^bonsai-export-\d{4}-\d{2}-\d{2}\.json$/)

    // Save and verify content
    const filePath = path.join('/tmp', download.suggestedFilename())
    await download.saveAs(filePath)
    const content = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(content)

    // Verify export structure
    expect(data.format).toBe('bonsai-export')
    expect(data.version).toBe(1)
    expect(data.exportedAt).toBeTruthy()
    expect(Array.isArray(data.conversations)).toBe(true)
    expect(Array.isArray(data.messages)).toBe(true)
    expect(Array.isArray(data.promptContextConfigs)).toBe(true)
    expect(Array.isArray(data.messageRevisions)).toBe(true)

    // Cleanup
    fs.unlinkSync(filePath)
  })

  test('import dialog shows validation summary for valid file', async ({ page }) => {
    // Navigate directly to settings
    await openSettings(page)
    await page.waitForSelector('[data-testid="data-storage-section"]')

    // Create a valid export file
    const validExport = {
      format: 'bonsai-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion: '1.0.0',
      conversations: [
        {
          id: 'test-conv-1',
          title: 'Test Conversation',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      messages: [
        {
          id: 'test-msg-1',
          conversationId: 'test-conv-1',
          parentId: null,
          role: 'user',
          content: 'Hello',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      promptContextConfigs: [],
      messageRevisions: [],
    }

    // Create file input event
    const fileInput = page.locator('[data-testid="import-file-input"]')

    // Upload the file
    await fileInput.setInputFiles({
      name: 'test-import.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(validExport)),
    })

    // Wait for import dialog
    await page.waitForSelector('[data-testid="import-dialog"]')

    // Verify validation passed
    await expect(page.locator('text=File is valid')).toBeVisible()
    await expect(page.locator('text=Conversations:')).toBeVisible()
    await expect(page.locator('[data-testid="confirm-import-btn"]')).toBeVisible()
  })

  test('import dialog shows errors for invalid file', async ({ page }) => {
    // Navigate directly to settings
    await openSettings(page)
    await page.waitForSelector('[data-testid="data-storage-section"]')

    // Create an invalid export file
    const invalidExport = {
      format: 'wrong-format',
      version: 1,
      conversations: [],
    }

    // Upload the invalid file
    const fileInput = page.locator('[data-testid="import-file-input"]')
    await fileInput.setInputFiles({
      name: 'invalid-import.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(invalidExport)),
    })

    // Wait for import dialog
    await page.waitForSelector('[data-testid="import-dialog"]')

    // Verify validation failed
    await expect(page.locator('text=Invalid file')).toBeVisible()
    await expect(page.locator('text=Invalid format')).toBeVisible()

    // Import button should not be visible
    await expect(page.locator('[data-testid="confirm-import-btn"]')).not.toBeVisible()
  })

  test('full export-import cycle preserves data structure', async ({ page }) => {
    // Create some test data by creating a conversation
    await page.goto('/conversations')
    await createConversation(page, { title: 'Export Test Conversation' })

    // Note the conversation ID from URL
    const url = page.url()
    const originalConvId = url.split('/conversation/')[1]

    // Go to settings and export
    await openSettings(page)
    await page.waitForSelector('[data-testid="data-storage-section"]')

    // Export data (click export, then confirm in format dialog)
    await page.click('[data-testid="export-all-btn"]')
    await page.waitForSelector('[data-testid="export-all-dialog"]')
    const downloadPromise = page.waitForEvent('download')
    await page.click('[data-testid="confirm-export-all-btn"]')
    const download = await downloadPromise

    // Save export file
    const filePath = path.join('/tmp', 'bonsai-test-export.json')
    await download.saveAs(filePath)
    const exportContent = fs.readFileSync(filePath, 'utf-8')
    const exportData = JSON.parse(exportContent)

    // Verify exported conversation
    expect(exportData.conversations.length).toBeGreaterThanOrEqual(1)
    const exportedConv = exportData.conversations.find(
      (c: { id: string }) => c.id === originalConvId
    )
    expect(exportedConv).toBeTruthy()

    // Handle confirmation dialog (must be set up BEFORE clicking)
    page.on('dialog', (dialog) => dialog.accept())

    // Clear all data using the Danger Zone
    await page.click('[data-testid="clear-conversations-btn"]')

    // Wait for page reload (clearConversationsOnly calls window.location.reload)
    await page.waitForLoadState('networkidle')
    await waitForAppReady(page)

    // Re-open settings overlay (closed by page reload)
    await openSettings(page)
    await page.waitForSelector('[data-testid="data-storage-section"]')

    // Import the exported file
    const fileInput = page.locator('[data-testid="import-file-input"]')
    await fileInput.setInputFiles({
      name: 'bonsai-test-export.json',
      mimeType: 'application/json',
      buffer: Buffer.from(exportContent),
    })

    // Wait for import dialog
    await page.waitForSelector('[data-testid="import-dialog"]')
    await expect(page.locator('text=File is valid')).toBeVisible()

    // Confirm import
    await page.click('[data-testid="confirm-import-btn"]')

    // Wait for success
    await expect(page.locator('text=Import successful!')).toBeVisible({ timeout: 10000 })

    // Verify conversations imported (count should match)
    const importedCount = await page
      .locator('text=Conversations imported:')
      .locator('..')
      .locator('span')
      .last()
      .textContent()
    expect(parseInt(importedCount || '0')).toBeGreaterThanOrEqual(1)

    // Close dialog and navigate home
    await page.locator('button:has-text("Close")').click()
    await page.goto('/conversations')

    // Verify conversation exists (may have different ID due to copy mode)
    await page.waitForSelector('[data-testid="conversation-list"]')
    const conversationItems = await page.locator('[data-testid="conversation-list"] > *').count()
    expect(conversationItems).toBeGreaterThanOrEqual(1)

    // Cleanup
    fs.unlinkSync(filePath)
  })
})
