import { expect, test, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { deleteEntityByBody, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import { waitForApiMutation } from '@open-mercato/core/modules/core/__integration__/helpers/ui'

/**
 * TC-CRM-PRECISION-004: the annual revenue inline editor keeps an exact amount stored through
 * the API when only the currency is changed.
 * Source: .ai/specs/2026-10-08-arbitrary-precision-money-and-fx.md
 */

const COMPANIES_API_BASE = '/api/customers/companies'
const EXACT_REVENUE = '25.123456789012345678'

async function fetchRevenue(request: APIRequestContext, token: string, companyId: string) {
  const response = await apiRequest(request, 'GET', `${COMPANIES_API_BASE}/${encodeURIComponent(companyId)}`, { token })
  expect(response.status(), 'GET company should return 200').toBe(200)
  const body = (await readJsonSafe(response)) as { profile?: { annualRevenue?: string | null } | null }
  return body.profile?.annualRevenue ?? null
}

test('TC-CRM-PRECISION-004: a currency-only revenue edit keeps the exact amount', async ({ page }) => {
  test.slow()
  const token = await getAuthToken(page.request, 'admin')
  const stamp = Date.now()
  let companyId: string | null = null

  try {
    const createResponse = await apiRequest(page.request, 'POST', COMPANIES_API_BASE, {
      token,
      data: { displayName: `QA Precision 004 ${stamp}`, annualRevenue: EXACT_REVENUE },
    })
    expect(createResponse.status(), 'company should be created').toBe(201)
    const created = (await readJsonSafe(createResponse)) as { id?: string; entityId?: string }
    companyId = created.id ?? created.entityId ?? null
    expect(typeof companyId, 'create response should expose the company id').toBe('string')
    expect(await fetchRevenue(page.request, token, companyId as string)).toBe(EXACT_REVENUE)

    await login(page, 'admin')
    await page.goto(`/backend/customers/companies/${companyId}`)

    const revenuePanel = page
      .locator('div.group')
      .filter({ has: page.locator('p', { hasText: /^Annual revenue$/i }) })
      .last()
    await expect(revenuePanel).toBeVisible({ timeout: 15_000 })
    await revenuePanel.click()

    const amountInput = revenuePanel.getByPlaceholder('Enter amount')
    await expect(amountInput).toHaveValue(EXACT_REVENUE, { timeout: 10_000 })

    const currencyTrigger = revenuePanel.getByRole('combobox').first()
    await expect(currencyTrigger).toBeEnabled({ timeout: 15_000 })
    await currencyTrigger.click()
    await page.getByRole('option').first().click()

    const settled = await waitForApiMutation(
      page,
      COMPANIES_API_BASE,
      () => revenuePanel.getByRole('button', { name: /^save$/i }).click(),
      'PUT',
      15_000,
    )
    expect(settled.status(), 'the currency-only save should succeed').toBeLessThan(400)

    expect(await fetchRevenue(page.request, token, companyId as string)).toBe(EXACT_REVENUE)
  } finally {
    await deleteEntityByBody(page.request, token, COMPANIES_API_BASE, companyId)
  }
})
