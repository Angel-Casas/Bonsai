/**
 * E2E Tests for Feedback Funnel (Milestone 14)
 *
 * Tests for Report Bug and Request Feature buttons.
 */

import { test, expect, Page } from '@playwright/test'
import { resetAppState, waitForAppReady } from './helpers'

test.describe('Feedback Funnel', () => {
  test.beforeEach(async ({ page }) => {
    await resetAppState(page)
    await page.reload()
    await waitForAppReady(page)
  })

  test('report bug button exists in settings', async ({ page }) => {
    await page.click('[data-testid="settings-btn"]')
    await expect(page.getByTestId('support-section')).toBeVisible()
    await expect(page.getByTestId('report-bug-btn')).toBeVisible()
    await expect(page.getByTestId('report-bug-btn')).toContainText('Report Bug')
  })

  test('request feature button exists in settings', async ({ page }) => {
    await page.click('[data-testid="settings-btn"]')
    await expect(page.getByTestId('support-section')).toBeVisible()
    await expect(page.getByTestId('request-feature-btn')).toBeVisible()
    await expect(page.getByTestId('request-feature-btn')).toContainText('Request Feature')
  })

  test('report bug button opens GitHub issue page', async ({ page, context }) => {
    await page.click('[data-testid="settings-btn"]')

    // Listen for popup/new tab
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      page.click('[data-testid="report-bug-btn"]'),
    ])

    // Verify the URL contains expected parts
    // GitHub may redirect to login, so we decode and check the full URL
    const url = decodeURIComponent(popup.url())
    expect(url).toContain('github.com/Angel-Casas/Bonsai/issues/new')
    expect(url).toContain('template=bug_report.yml')

    // Close the popup
    await popup.close()
  })

  test('request feature button opens GitHub issue page', async ({ page, context }) => {
    await page.click('[data-testid="settings-btn"]')

    // Listen for popup/new tab
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      page.click('[data-testid="request-feature-btn"]'),
    ])

    // Verify the URL contains expected parts
    // GitHub may redirect to login, so we decode and check the full URL
    const url = decodeURIComponent(popup.url())
    expect(url).toContain('github.com/Angel-Casas/Bonsai/issues/new')
    expect(url).toContain('template=feature_request.yml')

    // Close the popup
    await popup.close()
  })

  test('feedback URL includes privacy warning', async ({ page, context }) => {
    await page.click('[data-testid="settings-btn"]')

    // Listen for popup/new tab
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      page.click('[data-testid="report-bug-btn"]'),
    ])

    // Verify the URL body contains privacy warning
    // Need to fully decode to handle nested encoding (from GitHub redirect)
    let url = popup.url()
    // Decode multiple times if needed (GitHub login redirect double-encodes)
    while (url.includes('%25') || url.includes('%3')) {
      url = decodeURIComponent(url)
    }
    expect(url).toContain('Privacy Reminder')
    expect(url).toContain('Do NOT')

    await popup.close()
  })

  test('feedback URL does not contain sensitive data', async ({ page, context }) => {
    await page.click('[data-testid="settings-btn"]')

    // Listen for popup/new tab
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      page.click('[data-testid="report-bug-btn"]'),
    ])

    // Verify the URL does not contain sensitive patterns
    // Fully decode the URL first
    let url = popup.url()
    while (url.includes('%25') || url.includes('%3')) {
      url = decodeURIComponent(url)
    }
    expect(url).not.toMatch(/apiKey/i)
    expect(url).not.toMatch(/passphrase/i)
    expect(url).not.toMatch(/password/i)

    await popup.close()
  })
})
