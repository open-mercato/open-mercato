import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRandomCurrencyFixture,
  deleteCurrenciesEntityIfExists,
} from '@open-mercato/core/helpers/integration/currenciesFixtures'

test('TC-CUR-018: First exchange-rate save succeeds before organization scope initializes', async ({ page, request }, testInfo) => {
  const token = await getAuthToken(request, 'admin')
  let releaseScope: () => void = () => {}
  const scopeReady = new Promise<void>((resolve) => { releaseScope = resolve })
  let fromId: string | null = null
  let toId: string | null = null
  let rateId: string | null = null
  await page.route('**/api/directory/organization-switcher**', async (route) => {
    await scopeReady
    await route.continue().catch(() => {})
  })
  try {
    const from = await createRandomCurrencyFixture(request, token, { name: 'QA Early Rate From' })
    fromId = from.id
    const to = await createRandomCurrencyFixture(request, token, { name: 'QA Early Rate To' })
    toId = to.id
    await login(page, 'admin')
    await page.goto('/backend/exchange-rates/create')
    await expect(page.getByRole('heading', { name: 'Create Exchange Rate', exact: true })).toBeVisible()
    const currencies = page.getByRole('combobox', { name: 'Select currency', exact: true })
    await currencies.first().fill(from.code)
    await page.getByRole('option', { name: from.code, exact: true }).click()
    await currencies.nth(1).fill(to.code)
    await page.getByRole('option', { name: to.code, exact: true }).click()
    await page.getByRole('textbox', { name: '1.00000000', exact: true }).fill('1.25')
    await page.getByRole('textbox', { name: 'e.g., ECB, Manual', exact: true }).fill('QA-Early-Scope')
    await page.getByRole('button', { name: 'Pick date and time', exact: true }).click()
    await page.getByRole('button', { name: /^Today,/ }).click()
    await page.getByRole('button', { name: 'Apply', exact: true }).click()
    const created = page.waitForResponse((response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/currencies/exchange-rates',
    )
    await page.getByRole('button', { name: 'Create Exchange Rate', exact: true }).first().click()
    const response = await created
    const payload = response.request().postDataJSON() as Record<string, unknown>
    expect(payload).not.toHaveProperty('tenantId')
    expect(payload).not.toHaveProperty('organizationId')
    expect(response.status()).toBe(201)
    const body = await response.json() as { id: string }
    rateId = body.id
    expect(rateId).toBeTruthy()
    await expect(page).toHaveURL(/\/backend\/exchange-rates$/)
    releaseScope()
    await expect(page.getByRole('cell', { name: `${from.code} → ${to.code}`, exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('exchange-rate-created.png'), fullPage: true })
  } finally {
    releaseScope()
    await page.unroute('**/api/directory/organization-switcher**').catch(() => {})
    await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/exchange-rates', rateId)
    await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', toId)
    await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', fromId)
  }
})
