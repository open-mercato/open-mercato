import { expect, test, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { deleteEntityByBody, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import { fillControlledInput, waitForApiMutation } from '@open-mercato/core/modules/core/__integration__/helpers/ui'

/**
 * TC-CRM-PRECISION-002: a company whose annual revenue was stored through the API with more
 * than two decimals stays editable in the company form. Changing only the website must save
 * and keep the exact revenue.
 * Source: .ai/specs/2026-10-08-arbitrary-precision-money-and-fx.md
 */

const COMPANIES_API_BASE = '/api/customers/companies'
const EXACT_REVENUE = '2500000.125'

type CompanyDetail = {
  profile?: { annualRevenue?: string | null; websiteUrl?: string | null } | null
}

async function fetchProfile(request: APIRequestContext, token: string, companyId: string) {
  const response = await apiRequest(request, 'GET', `${COMPANIES_API_BASE}/${encodeURIComponent(companyId)}`, { token })
  expect(response.status(), 'GET company should return 200').toBe(200)
  return ((await readJsonSafe(response)) as CompanyDetail).profile ?? null
}

test('TC-CRM-PRECISION-002: editing only the website keeps an exact annual revenue', async ({ page }) => {
  const token = await getAuthToken(page.request, 'admin')
  const stamp = Date.now()
  const newWebsite = `https://precision-002-${stamp}.example.com`
  let companyId: string | null = null

  try {
    const createResponse = await apiRequest(page.request, 'POST', COMPANIES_API_BASE, {
      token,
      data: { displayName: `QA Precision 002 ${stamp}`, annualRevenue: EXACT_REVENUE },
    })
    expect(createResponse.status(), 'company should be created').toBe(201)
    const created = (await readJsonSafe(createResponse)) as { id?: string; entityId?: string }
    companyId = created.id ?? created.entityId ?? null
    expect(typeof companyId, 'create response should expose the company id').toBe('string')
    expect((await fetchProfile(page.request, token, companyId as string))?.annualRevenue).toBe(EXACT_REVENUE)

    await login(page, 'admin')
    await page.goto(`/backend/customers/companies-v2/${companyId}`)

    const nameInput = page.locator('[data-crud-field-id="displayName"] input').first()
    if (!(await nameInput.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: /^identity$/i }).first().click()
    }
    await expect(nameInput).not.toHaveValue('', { timeout: 15_000 })

    const websiteInput = page.locator('[data-crud-field-id="websiteUrl"] input').first()
    await expect(websiteInput).toBeVisible({ timeout: 15_000 })
    await fillControlledInput(websiteInput, newWebsite)

    const form = websiteInput.locator('xpath=ancestor::form[1]')
    await expect(form).toHaveCount(1)
    const settled = await waitForApiMutation(
      page,
      COMPANIES_API_BASE,
      () =>
        form.evaluate((node) => {
          if (!(node instanceof HTMLFormElement)) throw new Error('websiteUrl input is not inside a form')
          node.requestSubmit()
        }),
      'PUT',
      15_000,
    )
    expect(settled.status(), 'the website-only save should succeed').toBeLessThan(400)

    const after = await fetchProfile(page.request, token, companyId as string)
    expect(after?.websiteUrl).toBe(newWebsite)
    expect(after?.annualRevenue).toBe(EXACT_REVENUE)
  } finally {
    await deleteEntityByBody(page.request, token, COMPANIES_API_BASE, companyId)
  }
})
