import { test, expect } from '@playwright/test'

test.describe('Bonsai App', () => {
  test.describe('Landing Page', () => {
    test('loads and displays the landing page', async ({ page }) => {
      await page.goto('/')

      // Blueprint landing page uses hero-headline
      const headline = page.getByTestId('hero-headline')
      await expect(headline).toBeVisible()
      await expect(headline).toContainText('Bons')
    })

    test('enter button navigates to home', async ({ page }) => {
      await page.goto('/')

      // Blueprint landing uses enter-app-btn
      await page.getByTestId('enter-app-btn').click()

      // Should navigate to conversations page
      await expect(page).toHaveURL(/\/conversations/)
      await expect(page.getByTestId('app-header')).toBeVisible()
    })
  })

  test.describe('Home Page', () => {
    test('loads and displays the Bonsai header', async ({ page }) => {
      await page.goto('/conversations')

      // Wait for the header to be visible
      const header = page.getByTestId('app-header')
      await expect(header).toBeVisible()
      // Header contains the logo text "Bonsai" (among other elements)
      await expect(header).toContainText('Bonsai')
    })

    test('displays empty state message when no conversations', async ({ page }) => {
      await page.goto('/conversations')

      // Empty state shows guidance text
      await expect(
        page.getByText('Start Your First Conversation')
      ).toBeVisible()
    })

    test('shows new conversation button', async ({ page }) => {
      await page.goto('/conversations')

      await expect(page.getByTestId('new-conversation-btn')).toBeVisible()
    })
  })
})
