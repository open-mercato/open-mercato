import { expect, test } from '@playwright/test'

const viewports = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]

test.describe('TC-START-001: start page onboarding gate', () => {
  for (const viewport of viewports) {
    test(`${viewport.name} shows the connected onboarding state without layout or browser errors`, async ({ page }) => {
      const browserErrors: string[] = []
      page.on('console', (message) => {
        if (message.type() === 'error') browserErrors.push(message.text())
      })
      page.on('pageerror', (error) => browserErrors.push(error.message))
      await page.setViewportSize(viewport)

      const response = await page.goto('/start', { waitUntil: 'networkidle' })

      expect(response?.status()).toBe(200)
      await expect(page.getByRole('heading', { name: 'Welcome to Your Open Mercato Installation' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Launch your own workspace' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Start onboarding' })).toHaveAttribute('href', '/onboarding')
      await expect(page.getByRole('button', { name: 'Superadmin login disabled' })).toBeDisabled()
      const databaseStatusCard = page.getByText('Database Status', { exact: true }).locator('..')
      await expect(databaseStatusCard).toContainText(/Status:\s*Connected/)
      expect(await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )).toBe(false)
      expect(browserErrors).toEqual([])
    })
  }
})
