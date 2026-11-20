import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'

/**
 * TC-CRM-5232 (CRUDFORM path): the real person/company create forms and the detail Addresses tab
 * must persist and clear the Phase 3 address contact fields end to end.
 */

type AddressItem = { id: string; recipient_name?: string | null; phone?: string | null; address_line1?: string | null }

async function listAddresses(
  request: APIRequestContext,
  token: string,
  entityId: string,
): Promise<AddressItem[]> {
  const response = await apiRequest(request, 'GET', `/api/customers/addresses?entityId=${encodeURIComponent(entityId)}`, { token })
  expect(response.ok(), `list addresses status ${response.status()}`).toBeTruthy()
  const payload = (await response.json()) as { items?: AddressItem[] } | null
  return payload?.items ?? []
}

test.describe('TC-CRM-5232 address contact fields through the real forms', () => {
  let token: string | null = null
  let companyId: string | null = null

  test.beforeEach(async ({ request }) => {
    token = await getAuthToken(request)
  })

  test.afterEach(async ({ request }) => {
    await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    companyId = null
  })

  test('company create form saves recipient name and phone, and the detail editor clears them', async ({ page, request }) => {
    test.setTimeout(60_000)
    const stamp = Date.now()
    const companyName = `TC5232 Form Co ${stamp}`
    const line1 = `10 Form Street ${stamp}`
    await login(page, 'admin')

    await page.goto('/backend/customers/companies/create', { waitUntil: 'load' })
    await page.getByRole('main').getByRole('textbox').first().fill(companyName)
    await expect(page.getByRole('button', { name: 'Add address' })).toBeVisible()
    await page.getByRole('button', { name: 'Add address' }).click()
    if (!(await page.getByRole('textbox', { name: 'Address line 1' }).isVisible().catch(() => false))) {
      await page.getByRole('button', { name: 'Add address' }).click()
    }
    await expect(page.getByRole('textbox', { name: 'Address line 1' })).toBeVisible({ timeout: 15000 })
    await page.getByRole('textbox', { name: 'Address line 1' }).fill(line1)
    await page.getByRole('textbox', { name: 'Recipient name' }).fill(`Form Recipient ${stamp}`)
    await page.getByRole('textbox', { name: 'Phone' }).fill('+48 600 123 456')
    await page.getByRole('button', { name: 'Save address' }).click()

    const companyCreated = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/customers/companies' && response.request().method() === 'POST',
    )
    const addressCreated = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/customers/addresses' && response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: 'Create Company' }).first().click()
    const companyBody = (await (await companyCreated).json()) as { id?: string; entityId?: string }
    companyId = companyBody.id ?? companyBody.entityId ?? null
    expect(companyId, 'company create response exposes the id').toBeTruthy()
    expect((await addressCreated).ok()).toBe(true)

    const created = await listAddresses(request, token as string, companyId as string)
    expect(created).toHaveLength(1)
    expect(created[0].recipient_name).toBe(`Form Recipient ${stamp}`)
    expect(created[0].phone).toBe('+48 600 123 456')

    await page.goto(`/backend/customers/companies/${companyId}`, { waitUntil: 'load' })
    await page.getByRole('tab', { name: 'Addresses' }).click()
    if (!(await page.getByRole('button', { name: 'Edit address' }).first().isVisible().catch(() => false))) {
      await page.getByRole('tab', { name: 'Addresses' }).click()
    }
    await expect(page.getByRole('button', { name: 'Edit address' }).first()).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: 'Edit address' }).first().click()
    await expect(page.getByRole('textbox', { name: 'Recipient name' })).toHaveValue(`Form Recipient ${stamp}`)
    await page.getByRole('textbox', { name: 'Recipient name' }).fill('')
    await page.getByRole('textbox', { name: 'Phone' }).fill('')
    const updated = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/customers/addresses' && response.request().method() === 'PUT',
    )
    await page.getByRole('button', { name: 'Update address' }).click()
    expect((await updated).ok()).toBe(true)

    await expect
      .poll(async () => {
        const items = await listAddresses(request, token as string, companyId as string)
        return items[0] ? { recipient: items[0].recipient_name ?? null, phone: items[0].phone ?? null } : null
      })
      .toEqual({ recipient: null, phone: null })
    const afterClear = await listAddresses(request, token as string, companyId as string)
    expect(afterClear[0].address_line1).toBe(line1)
  })
})
