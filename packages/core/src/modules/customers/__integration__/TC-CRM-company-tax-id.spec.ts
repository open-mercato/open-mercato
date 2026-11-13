import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

/**
 * TC-CRM-company-tax-id: VAT / tax ID on the company profile
 *
 * Companies carry an optional `taxId` (NIP / VAT ID) on their profile. Every
 * create path accepts a company without one (not VAT-registered, foreign,
 * early-stage lead); a stored value flows through the detail form, the list
 * column and the API.
 *
 * Verifies:
 *   1. The company create page saves a company that has no VAT ID.
 *   2. The Sales document quick-create saves a company that has no VAT ID.
 *   3. The detail edit form prefills a stored VAT ID and the companies list shows it.
 *   4. The API round-trips `taxId` on create, detail and update.
 */

const TAX_ID = 'PL1234567890'

type CompanyDetail = { profile?: { taxId?: string | null } | null }

async function readCompanyTaxId(request: APIRequestContext, token: string, companyId: string): Promise<string | null> {
  const detail = await apiRequest(request, 'GET', `/api/customers/companies/${companyId}`, { token })
  expect(detail.ok(), `GET company returned ${detail.status()}`).toBeTruthy()
  const body = await detail.json() as CompanyDetail
  return body.profile?.taxId ?? null
}

function readCreatedId(payload: { id?: string; entityId?: string; companyId?: string }): string | null {
  return payload.entityId ?? payload.id ?? payload.companyId ?? null
}

async function fillCompanyName(page: Page, scope: Page | ReturnType<Page['getByRole']>, name: string): Promise<void> {
  const nameInput = scope.locator('[data-crud-field-id="displayName"] input').first()
  await expect(nameInput).toBeVisible({ timeout: 30_000 })
  await nameInput.fill(name)
  await expect(nameInput).toHaveValue(name)
}

test.describe('TC-CRM-company-tax-id: VAT ID on companies', () => {
  test('the create page saves a company without a VAT ID', async ({ page, request }) => {
    const stamp = Date.now()
    const companyName = `QA no-VAT company ${stamp}`
    let token: string | null = null
    let companyId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      await login(page, 'admin')
      await page.goto('/backend/customers/companies/create', { waitUntil: 'domcontentloaded' })

      await fillCompanyName(page, page, companyName)
      const taxIdInput = page.locator('[data-crud-field-id="taxId"] input').first()
      await expect(taxIdInput).toBeVisible()
      await expect(taxIdInput).toHaveValue('')

      await page.locator('form').getByRole('button', { name: /Create Company/i }).click()
      await expect(page).toHaveURL(/\/backend\/customers\/companies-v2\/[0-9a-f-]{36}$/i, { timeout: 30_000 })
      companyId = page.url().match(/companies-v2\/([0-9a-f-]{36})/i)?.[1] ?? null
      expect(companyId, 'created company id').toBeTruthy()

      expect(await readCompanyTaxId(request, token, companyId!)).toBeNull()
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('the Sales document quick-create saves a company without a VAT ID', async ({ page, request }) => {
    const stamp = Date.now()
    const companyName = `QA no-VAT quick company ${stamp}`
    let token: string | null = null
    let companyId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      await login(page, 'admin')
      await page.goto('/backend/sales/documents/create', { waitUntil: 'domcontentloaded' })

      const createCustomerTrigger = page.getByRole('button', { name: 'Create customer' })
      const createCompanyItem = page.getByRole('button', { name: /(?:New|Create) company/ })
      await expect(createCustomerTrigger).toBeVisible({ timeout: 30_000 })
      await expect(async () => {
        await createCustomerTrigger.click()
        await expect(createCompanyItem).toBeVisible({ timeout: 1_500 })
      }).toPass({ timeout: 15_000 })
      await createCompanyItem.click()

      const dialog = page.getByRole('dialog', { name: /(?:New|Create) company/ })
      await expect(dialog).toBeVisible()
      await fillCompanyName(page, dialog, companyName)
      await expect(dialog.locator('[data-crud-field-id="taxId"] input').first()).toHaveValue('')

      const createResponsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url())
        return url.pathname === '/api/customers/companies' && response.request().method() === 'POST'
      })
      await dialog.getByRole('button', { name: 'Save', exact: true }).click()
      const createResponse = await createResponsePromise
      expect(createResponse.ok(), `Quick company create failed: ${createResponse.status()}`).toBeTruthy()
      companyId = readCreatedId(await createResponse.json())
      expect(companyId, 'created company id').toBeTruthy()
      await expect(dialog).toBeHidden()

      expect(await readCompanyTaxId(request, token, companyId!)).toBeNull()
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('the detail form prefills a stored VAT ID and the list shows it', async ({ page, request }) => {
    test.slow()
    const stamp = Date.now()
    const companyName = `QA VAT company ${stamp}`
    let token: string | null = null
    let companyId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const created = await apiRequest(request, 'POST', '/api/customers/companies', {
        token,
        data: { displayName: companyName, taxId: TAX_ID },
      })
      expect(created.ok(), `POST company returned ${created.status()}`).toBeTruthy()
      companyId = readCreatedId(await created.json())
      expect(companyId, 'created company id').toBeTruthy()

      await login(page, 'admin')
      await page.goto(`/backend/customers/companies-v2/${companyId}`, { waitUntil: 'domcontentloaded' })

      // The detail form can render as a collapsed rail with no inputs until a section is opened.
      const detailTaxId = page.locator('[data-crud-field-id="taxId"] input').first()
      await expect(async () => {
        if (!(await detailTaxId.isVisible().catch(() => false))) {
          const identitySection = page.getByRole('button', { name: /^identity$/i }).first()
          if (await identitySection.isVisible().catch(() => false)) await identitySection.click()
        }
        await expect(detailTaxId).toHaveValue(TAX_ID, { timeout: 3_000 })
      }).toPass({ timeout: 30_000 })

      await page.goto('/backend/customers/companies', { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: 'Refresh' }).waitFor()
      const searchInput = page.getByPlaceholder(/Search by name/i)
      await searchInput.fill(companyName)
      const row = page.getByRole('row').filter({ hasText: companyName }).first()
      await expect(row).toBeVisible({ timeout: 30_000 })
      await expect(row.getByText(TAX_ID, { exact: true })).toBeVisible()
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('the API accepts and returns the VAT ID', async ({ request }) => {
    const stamp = Date.now()
    let token: string | null = null
    let companyId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const created = await apiRequest(request, 'POST', '/api/customers/companies', {
        token,
        data: { displayName: `QA VAT api company ${stamp}`, taxId: 'DE123456789' },
      })
      expect(created.ok(), `POST company returned ${created.status()}`).toBeTruthy()
      companyId = readCreatedId(await created.json())
      expect(companyId, 'created company id').toBeTruthy()

      expect(await readCompanyTaxId(request, token, companyId!)).toBe('DE123456789')

      const updated = await apiRequest(request, 'PUT', '/api/customers/companies', {
        token,
        data: { id: companyId, taxId: 'DE987654321' },
      })
      expect(updated.ok(), `PUT company returned ${updated.status()}`).toBeTruthy()
      expect(await readCompanyTaxId(request, token, companyId!)).toBe('DE987654321')
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
