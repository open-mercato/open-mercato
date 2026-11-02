import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

/**
 * TC-CRM-company-tax-id: VAT / tax ID on the company profile
 *
 * Companies carry a dedicated `taxId` (NIP / VAT ID) that every company form
 * requires, while the API keeps the column optional for existing records and
 * integrations.
 *
 * Verifies:
 *   1. The create form refuses to save without a VAT ID, saves with one, and the
 *      detail page prefills it in the edit form.
 *   2. The companies list shows the VAT ID column.
 *   3. The API round-trips `taxId` on create and detail.
 */

const TAX_ID = 'PL1234567890'

test.describe('TC-CRM-company-tax-id: VAT ID on companies', () => {
  test('the create form requires the VAT ID and the record keeps it', async ({ page, request }) => {
    test.slow()
    const stamp = Date.now()
    const companyName = `QA VAT company ${stamp}`
    let token: string | null = null
    let companyId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      await login(page, 'admin')
      await page.goto('/backend/customers/companies/create', { waitUntil: 'domcontentloaded' })

      const nameInput = page.locator('[data-crud-field-id="displayName"] input').first()
      const taxIdInput = page.locator('[data-crud-field-id="taxId"] input').first()
      await expect(nameInput).toBeVisible({ timeout: 30_000 })
      await expect(taxIdInput).toBeVisible()
      await nameInput.fill(companyName)
      await expect(nameInput).toHaveValue(companyName)

      const submit = page.locator('form').getByRole('button', { name: /Create Company/i })
      // A click can land before the form hydrates, so repeat it until validation answers.
      const requiredError = page.locator('[data-crud-field-id="taxId"]').getByText(/required/i).first()
      await expect(async () => {
        await submit.click()
        await expect(requiredError).toBeVisible({ timeout: 3_000 })
      }).toPass({ timeout: 30_000 })
      await expect(page).toHaveURL(/\/backend\/customers\/companies\/create$/i)

      await nameInput.fill(companyName)
      await expect(nameInput).toHaveValue(companyName)
      await taxIdInput.fill(TAX_ID)
      await expect(taxIdInput).toHaveValue(TAX_ID)
      await submit.click()
      await expect(page).toHaveURL(/\/backend\/customers\/companies-v2\/[0-9a-f-]{36}$/i, { timeout: 30_000 })
      companyId = page.url().match(/companies-v2\/([0-9a-f-]{36})/i)?.[1] ?? null
      expect(companyId, 'created company id').toBeTruthy()

      // The detail form can render as a collapsed rail with no inputs until a section is opened.
      const detailTaxId = page.locator('[data-crud-field-id="taxId"] input').first()
      await expect(async () => {
        if (!(await detailTaxId.isVisible().catch(() => false))) {
          const identitySection = page.getByRole('button', { name: /^identity$/i }).first()
          if (await identitySection.isVisible().catch(() => false)) await identitySection.click()
        }
        await expect(detailTaxId).toHaveValue(TAX_ID, { timeout: 3_000 })
      }).toPass({ timeout: 30_000 })

      const detail = await apiRequest(request, 'GET', `/api/customers/companies/${companyId}`, { token })
      expect(detail.ok(), `GET company returned ${detail.status()}`).toBeTruthy()
      const body = await detail.json() as { profile?: { taxId?: string | null } }
      expect(body.profile?.taxId).toBe(TAX_ID)

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
      const createdBody = await created.json() as { id?: string; entityId?: string; companyId?: string }
      companyId = createdBody.id ?? createdBody.entityId ?? createdBody.companyId ?? null
      expect(companyId, 'created company id').toBeTruthy()

      const detail = await apiRequest(request, 'GET', `/api/customers/companies/${companyId}`, { token })
      expect(detail.ok()).toBeTruthy()
      const body = await detail.json() as { profile?: { taxId?: string | null } }
      expect(body.profile?.taxId).toBe('DE123456789')

      const updated = await apiRequest(request, 'PUT', '/api/customers/companies', {
        token,
        data: { id: companyId, taxId: 'DE987654321' },
      })
      expect(updated.ok(), `PUT company returned ${updated.status()}`).toBeTruthy()
      const after = await apiRequest(request, 'GET', `/api/customers/companies/${companyId}`, { token })
      const afterBody = await after.json() as { profile?: { taxId?: string | null } }
      expect(afterBody.profile?.taxId).toBe('DE987654321')
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
