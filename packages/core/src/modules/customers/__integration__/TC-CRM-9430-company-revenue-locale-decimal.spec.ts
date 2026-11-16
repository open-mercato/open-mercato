import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { deleteEntityIfExists, readJsonSafe } from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-CRM-9430: company annual revenue typed with a Polish decimal comma is saved as typed (#9430).
 *
 * The create form used to strip every `,` as a thousands separator, so `1234,56` was saved as
 * 123456 under the `pl` UI locale. This drives the real create form in a browser, reads the
 * company back from the API after a reload, and checks invalid input never reaches the API.
 * Every company it creates is deleted in `finally`.
 */

const COMPANY_ID_IN_URL = /\/backend\/customers\/companies-v2\/([0-9a-f-]{36})$/i

async function readAnnualRevenue(request: APIRequestContext, token: string, companyId: string): Promise<string | null> {
  const response = await apiRequest(request, 'GET', `/api/customers/companies/${companyId}`, { token })
  expect(response.status(), `GET /api/customers/companies/${companyId}`).toBe(200)
  const body = await readJsonSafe<{ profile?: { annualRevenue?: string | number | null } | null }>(response)
  const value = body?.profile?.annualRevenue
  return value === null || value === undefined ? null : String(value)
}

async function fillCreateForm(page: Page, name: string, revenue: string) {
  await page.goto('/backend/customers/companies/create', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl')
  const form = page.locator('form')
  await form.locator('[data-crud-field-id="displayName"]').getByRole('textbox').fill(name)
  await form.locator('[data-crud-field-id="annualRevenue"]').getByRole('textbox').fill(revenue)
}

async function createViaForm(page: Page, name: string, revenue: string): Promise<string> {
  await fillCreateForm(page, name, revenue)
  await page.locator('form').getByRole('button', { name: 'Utwórz firmę' }).first().click()
  await expect(page).toHaveURL(COMPANY_ID_IN_URL, { timeout: 30_000 })
  const companyId = page.url().match(COMPANY_ID_IN_URL)?.[1] ?? null
  expect(companyId, 'created company id in detail URL').toBeTruthy()
  return companyId!
}

test('TC-CRM-9430: pl company create form saves annual revenue 1234,56 as 1234.56', async ({ page, request }) => {
  test.slow()
  const token = await getAuthToken(request, 'admin')
  const stamp = randomUUID().slice(0, 8)
  const createdIds: string[] = []
  let originalLocale = 'en'

  try {
    await login(page, 'admin')
    originalLocale = (await page.context().cookies()).find((cookie) => cookie.name === 'locale')?.value ?? 'en'
    expect((await page.request.post('/api/auth/locale', { data: { locale: 'pl' } })).status()).toBe(200)

    const companyWrites: string[] = []
    page.on('request', (req) => {
      if (new URL(req.url()).pathname === '/api/customers/companies' && req.method() === 'POST') {
        companyWrites.push(req.url())
      }
    })

    // Over-precise input: inline error, no write.
    await fillCreateForm(page, `QA 9430 invalid ${stamp}`, '1234,567')
    await page.locator('form').getByRole('button', { name: 'Utwórz firmę' }).first().click()
    await expect(page.getByText('Wpisz poprawną kwotę (do dwóch miejsc po przecinku).').first()).toBeVisible()
    await expect(page).toHaveURL(/\/backend\/customers\/companies\/create/)
    expect(companyWrites, 'invalid revenue must not reach the API').toEqual([])

    // Polish decimal comma.
    const commaId = await createViaForm(page, `QA 9430 comma ${stamp}`, '1234,56')
    createdIds.push(commaId)
    // Equivalent dot input.
    const dotId = await createViaForm(page, `QA 9430 dot ${stamp}`, '1234.56')
    createdIds.push(dotId)

    for (const companyId of [commaId, dotId]) {
      await page.goto(`/backend/customers/companies-v2/${companyId}`, { waitUntil: 'domcontentloaded' })
      await page.reload({ waitUntil: 'domcontentloaded' })
      expect(Number(await readAnnualRevenue(request, token, companyId))).toBe(1234.56)
    }
  } finally {
    try {
      for (const id of createdIds) await deleteEntityIfExists(request, token, '/api/customers/companies', id)
    } finally {
      await page.request.post('/api/auth/locale', { data: { locale: originalLocale } }).catch(() => undefined)
    }
  }
})
