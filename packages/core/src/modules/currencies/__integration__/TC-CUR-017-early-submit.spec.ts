import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  deleteCurrenciesEntityIfExists,
  generateUniqueCurrencyCode,
} from '@open-mercato/core/helpers/integration/currenciesFixtures'

test('TC-CUR-017: First currency save succeeds before organization scope initializes', async ({ page, request }, testInfo) => {
  const token = await getAuthToken(request, 'admin')
  let releaseScope: () => void = () => {}
  const scopeReady = new Promise<void>((resolve) => { releaseScope = resolve })
  let currencyId: string | null = null
  await page.route('**/api/directory/organization-switcher**', async (route) => {
    await scopeReady
    await route.continue().catch(() => {})
  })
  try {
    await login(page, 'admin')
    await page.goto('/backend/currencies/create')
    await expect(page.getByRole('heading', { name: 'Create Currency', exact: true })).toBeVisible()
    await page.getByRole('textbox', { name: 'US Dollar', exact: true }).fill('QA Immediate Currency')
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await page.getByRole('textbox', { name: 'USD', exact: true }).fill(generateUniqueCurrencyCode())
      const created = page.waitForResponse((response) =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/currencies/currencies',
      )
      await page.getByRole('button', { name: 'Create Currency', exact: true }).first().click()
      const response = await created
      const payload = response.request().postDataJSON() as Record<string, unknown>
      expect(payload).not.toHaveProperty('tenantId')
      expect(payload).not.toHaveProperty('organizationId')
      const body = await response.json() as { id?: string; error?: string }
      const codeCollision = response.status() === 409
        && body.error === 'Currency code already exists for this organization.'
      if (codeCollision && attempt < 7) continue
      expect(response.status()).toBe(201)
      currencyId = body.id ?? null
      break
    }
    expect(currencyId).toBeTruthy()
    await expect(page).toHaveURL(/\/backend\/currencies$/)
    releaseScope()
    await expect(page.getByText('QA Immediate Currency', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('currency-created.png'), fullPage: true })
  } finally {
    releaseScope()
    await page.unroute('**/api/directory/organization-switcher**').catch(() => {})
    await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', currencyId)
  }
})
