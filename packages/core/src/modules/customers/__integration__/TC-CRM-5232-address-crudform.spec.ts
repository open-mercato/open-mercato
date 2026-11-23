import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId } from '@open-mercato/core/helpers/integration/generalFixtures'

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
  let personId: string | null = null

  test.beforeEach(async ({ request }) => {
    token = await getAuthToken(request)
  })

  test.afterEach(async ({ request }) => {
    await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    companyId = null
    await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    personId = null
  })

  test('company create form saves recipient name and phone, and the detail editor clears them', async ({ page, request }) => {
    test.setTimeout(60_000)
    const stamp = Date.now()
    const companyName = `TC5232 Form Co ${stamp}`
    const line1 = `10 Form Street ${stamp}`
    const recipientName = 'R'.repeat(200)
    const phone = '9'.repeat(50)
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
    await page.getByRole('textbox', { name: 'Recipient name' }).fill(recipientName)
    await page.getByRole('textbox', { name: 'Phone' }).fill(phone)
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
    expect(created[0].recipient_name).toBe(recipientName)
    expect(created[0].phone).toBe(phone)

    await page.goto(`/backend/customers/companies/${companyId}`, { waitUntil: 'load' })
    await page.getByRole('tab', { name: 'Addresses' }).click()
    if (!(await page.getByRole('button', { name: 'Edit address' }).first().isVisible().catch(() => false))) {
      await page.getByRole('tab', { name: 'Addresses' }).click()
    }
    await expect(page.getByRole('button', { name: 'Edit address' }).first()).toBeVisible({ timeout: 15000 })
    const contact = page.getByTestId('address-contact')
    await expect(contact).toHaveText(`${recipientName} · ${phone}`)
    const tile = page.getByTestId('address-tile').filter({ has: contact })
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expect.poll(() => tile.evaluate((element) => ({
        tileOverflow: element.scrollWidth - element.clientWidth,
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      })), { message: `address contact at ${width}px` }).toEqual({ tileOverflow: 0, pageOverflow: 0 })
    }
    await page.getByRole('button', { name: 'Edit address' }).first().click()
    await expect(page.getByRole('textbox', { name: 'Recipient name' })).toHaveValue(recipientName)
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

  test('person create form saves address recipient name and phone', async ({ page, request }) => {
    const stamp = Date.now()
    const firstName = `TC5232 ${stamp}`
    const lastName = 'Person'
    const addressLine1 = `11 Form Street ${stamp}`
    const recipientName = `Person Recipient ${stamp}`
    const phone = '+48 600 123 457'
    await login(page, 'admin')

    await page.goto('/backend/customers/people/create', { waitUntil: 'load' })
    await page.getByRole('textbox', { name: /^First name/ }).fill(firstName)
    await page.getByRole('textbox', { name: /^Last name/ }).fill(lastName)
    await expect(page.getByText(`${firstName} ${lastName}`, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Add address', exact: true }).click()
    await page.getByPlaceholder('Address line 1', { exact: true }).fill(addressLine1)
    await page.getByRole('textbox', { name: 'Recipient name', exact: true }).fill(recipientName)
    await page.getByRole('textbox', { name: 'Phone', exact: true }).fill(phone)
    await page.getByRole('button', { name: 'Save address' }).click()

    const addressCreated = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/customers/addresses' && response.request().method() === 'POST',
    ).catch(() => null)
    const [personResponse] = await Promise.all([
      page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/api/customers/people' && response.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Create Person', exact: true }).first().click(),
    ])
    expect(personResponse.ok(), `person create status ${personResponse.status()}`).toBe(true)
    const personBody = (await personResponse.json()) as { id?: string; entityId?: string }
    personId = expectId(personBody.id ?? personBody.entityId, 'person create response exposes the id')

    const addressResponse = await addressCreated
    expect(addressResponse?.ok(), `address create status ${addressResponse?.status() ?? 'missing response'}`).toBe(true)

    const persisted = await listAddresses(request, token as string, personId)
    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toMatchObject({ address_line1: addressLine1, recipient_name: recipientName, phone })
  })
})
