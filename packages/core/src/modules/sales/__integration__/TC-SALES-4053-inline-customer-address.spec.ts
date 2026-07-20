import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type JsonRecord = Record<string, unknown>

function readId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as JsonRecord
  for (const key of ['entityId', 'id', 'result']) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) return value
    const nested = readId(value)
    if (nested) return nested
  }
  return null
}

async function deleteCustomerEntity(
  request: APIRequestContext,
  token: string,
  path: string,
  id: string | null,
): Promise<void> {
  if (!id) return
  await apiRequest(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, { token }).catch(() => undefined)
}

async function loginAdmin(page: Page): Promise<string> {
  const response = await page.request.post('/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: new URLSearchParams({ email: 'admin@acme.com', password: 'secret' }).toString(),
  })
  expect(response.ok(), `Admin login failed: ${response.status()}`).toBeTruthy()
  const payload = await readJsonSafe<{ token?: string }>(response)
  expect(payload?.token).toBeTruthy()
  const token = payload!.token!
  const scope = getTokenScope(token)
  const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([
    { name: 'om_demo_notice_ack', value: 'ack', url: baseUrl },
    { name: 'om_cookie_notice_ack', value: 'ack', url: baseUrl },
    { name: 'om_feedback_suppress', value: '1', url: baseUrl },
    { name: 'om_selected_tenant', value: scope.tenantId, url: baseUrl },
    { name: 'om_selected_org', value: scope.organizationId, url: baseUrl },
  ])
  return token
}

test.describe('TC-SALES-4053: inline customer address persistence', () => {
  test('persists an address added while creating a person from the order form', async ({ page, request }) => {
    const token = await loginAdmin(page)
    const stamp = Date.now()
    const displayName = `QA Inline ${stamp}`
    const addressLine = `${stamp} Persist Street`
    let personId: string | null = null
    let addressId: string | null = null

    try {
      await page.goto('/backend/sales/documents/create', { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: 'Create customer' }).click()
      await page.getByRole('button', { name: /(?:New|Create) person/ }).click()

      const dialog = page.getByRole('dialog', { name: /(?:New|Create) person/ })
      await expect(dialog).toBeVisible()
      await dialog.getByText('First name *').locator('..').getByRole('textbox').fill('QA')
      await dialog.getByText('Last name *').locator('..').getByRole('textbox').fill(`Inline ${stamp}`)
      await dialog.getByRole('button', { name: 'Add address' }).click()
      await dialog.getByRole('textbox', { name: /Address line 1|Street/ }).fill(addressLine)
      await dialog.getByRole('textbox', { name: 'City' }).fill('Warsaw')
      await dialog.getByRole('button', { name: /Save address/ }).click()
      await expect(dialog.getByText(addressLine)).toBeVisible()

      const personResponsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url())
        return url.pathname === '/api/customers/people' && response.request().method() === 'POST'
      })
      const addressResponsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url())
        return url.pathname === '/api/customers/addresses' && response.request().method() === 'POST'
      })
      await dialog.getByRole('button', { name: 'Save', exact: true }).click()

      const personResponse = await personResponsePromise
      expect(personResponse.ok(), `Inline person create failed: ${personResponse.status()}`).toBeTruthy()
      personId = readId(await personResponse.json())
      expect(personId).toBeTruthy()

      const addressResponse = await addressResponsePromise
      expect(addressResponse.ok(), `Inline address create failed: ${addressResponse.status()}`).toBeTruthy()
      addressId = readId(await addressResponse.json())
      expect(addressResponse.request().postDataJSON()).toMatchObject({
        entityId: personId,
        addressLine1: addressLine,
      })
      await expect(dialog).toBeHidden()

      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/addresses?entityId=${encodeURIComponent(personId!)}`,
        { token },
      )
      expect(listResponse.ok()).toBeTruthy()
      const payload = await readJsonSafe<{ items?: JsonRecord[] }>(listResponse)
      expect(payload?.items?.some((item) => item.address_line1 === addressLine || item.addressLine1 === addressLine)).toBe(true)
      await expect(page.getByText(displayName).first()).toBeVisible()
    } finally {
      await deleteCustomerEntity(request, token, '/api/customers/addresses', addressId)
      await deleteCustomerEntity(request, token, '/api/customers/people', personId)
    }
  })
})
