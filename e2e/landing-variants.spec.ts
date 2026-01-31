import { test, expect } from '@playwright/test'

test.describe('Landing Page', () => {
  test('loads and displays the landing page', async ({ page }) => {
    await page.goto('/')

    const headline = page.getByTestId('hero-headline')
    await expect(headline).toBeVisible()
    // Variant C has "BonsAI" split across elements
    await expect(headline).toContainText('Bons')
  })

  test('has both CTAs', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByTestId('enter-app-btn')).toBeVisible()
    await expect(page.getByTestId('watch-demo-btn')).toBeVisible()
  })

  test('enter app button navigates to home', async ({ page }) => {
    await page.goto('/')

    await page.getByTestId('enter-app-btn').click()

    await expect(page).toHaveURL(/\/conversations/)
  })

  test('watch demo button scrolls to visualization', async ({ page }) => {
    await page.goto('/')

    await page.getByTestId('watch-demo-btn').click()

    // The branching-viz section should be in view
    const vizSection = page.locator('#branching-viz')
    await expect(vizSection).toBeVisible()
  })
})
