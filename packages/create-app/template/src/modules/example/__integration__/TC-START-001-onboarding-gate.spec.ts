import { expect, test } from '@playwright/test'

// `/start` renders the onboarding CTA only when the app has self-service onboarding on AND a
// configured email transport (src/app/start/page.tsx). This spec asserts that
// connected state, so it only runs in lanes that configure both.
export const integrationMeta = {
  dependsOnModules: ['onboarding'],
  requiredEnvVars: ['SELF_SERVICE_ONBOARDING_ENABLED', 'SYSTEM_EMAIL_PROVIDER'],
}

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
      await expect(page.getByRole('heading', { level: 1, name: 'Getting started' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Create a workspace' })).toHaveAttribute('href', '/onboarding')
      await expect(page.getByRole('link', { name: 'Log in as Super Admin' })).toHaveCount(0)
      await expect(page.getByRole('link', { name: 'Log in as Admin' })).toHaveAttribute('href', /^\/login\?role=admin&email=/)
      await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)
      expect(await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )).toBe(false)
      expect(browserErrors).toEqual([])
    })
  }
})
