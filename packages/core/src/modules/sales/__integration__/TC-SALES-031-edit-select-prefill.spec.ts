import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createUserFixture,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createCompanyFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  createOrderLineFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'

type FixtureOption = {
  id: string
  name: string
}

type FixtureScope = {
  organizationId: string
  tenantId: string
}

function readTokenClaims(token: string): { tenantId?: string; orgId?: string | null } {
  const parts = token.split('.')
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as {
    tenantId?: string
    orgId?: string | null
  }
}

async function loginWithCredentials(page: Page, email: string, password: string): Promise<void> {
  const form = new URLSearchParams()
  form.set('email', email)
  form.set('password', password)
  const response = await page.request.post('/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  })
  expect(response.ok(), `Failed to login test sales user: ${response.status()}`).toBeTruthy()
  const payload = await readJsonSafe<{ token?: string }>(response)
  expect(typeof payload?.token === 'string' && payload.token.length > 0, 'Login response should include a token').toBeTruthy()
  const claims = readTokenClaims(payload!.token!)
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  const cookies = [
    { name: 'om_demo_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' as const },
    { name: 'om_cookie_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' as const },
    { name: 'om_feedback_suppress', value: '1', url: baseUrl, sameSite: 'Lax' as const },
  ]
  if (claims.tenantId) {
    cookies.push({ name: 'om_selected_tenant', value: claims.tenantId, url: baseUrl, sameSite: 'Lax' as const })
  }
  if (claims.orgId) {
    cookies.push({ name: 'om_selected_org', value: claims.orgId, url: baseUrl, sameSite: 'Lax' as const })
  }
  await page.context().addCookies(cookies)
  await page.goto('/backend', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/\/backend(?:\/.*)?$/)
}

async function createEntity(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  expect(response.ok(), `Failed POST ${path}: ${response.status()}`).toBeTruthy()
  const payload = await readJsonSafe(response)
  const id = typeof (payload as Record<string, unknown>).id === 'string'
    ? ((payload as Record<string, unknown>).id as string)
    : null
  expect(id, `No id in POST ${path} response`).toBeTruthy()
  return id as string
}

async function createBatched<T>(
  count: number,
  createOne: (index: number) => Promise<T>,
  batchSize = 8,
): Promise<T[]> {
  const results: T[] = []
  for (let index = 0; index < count; index += batchSize) {
    const batch = Array.from({ length: Math.min(batchSize, count - index) }, (_, offset) => index + offset)
    results.push(...(await Promise.all(batch.map((entry) => createOne(entry)))))
  }
  return results
}

async function createTaxRates(
  request: APIRequestContext,
  token: string,
  stamp: number,
): Promise<FixtureOption[]> {
  return createBatched(202, async (index) => {
    const padded = String(index).padStart(3, '0')
    const name = `QA Sales Tax ${stamp} ${padded}`
    const id = await createEntity(request, token, '/api/sales/tax-rates', {
      name,
      code: `qa-sales-tax-${stamp}-${padded}`,
      rate: 19,
      priority: index % 10,
    })
    return { id, name }
  })
}

async function createShippingMethods(
  request: APIRequestContext,
  token: string,
  stamp: number,
): Promise<FixtureOption[]> {
  return createBatched(52, async (index) => {
    const padded = String(index).padStart(3, '0')
    const name = `QA Shipping Method ${stamp} ${padded}`
    const id = await createEntity(request, token, '/api/sales/shipping-methods', {
      name,
      code: `qa-ship-${stamp}-${padded}`,
      baseRateNet: '10',
      baseRateGross: '12',
      currencyCode: 'USD',
      isActive: true,
    })
    return { id, name }
  })
}

async function createShipmentStatuses(
  request: APIRequestContext,
  token: string,
  stamp: number,
): Promise<FixtureOption[]> {
  return createBatched(102, async (index) => {
    const padded = String(index).padStart(3, '0')
    const name = `QA Shipment Status ${stamp} ${padded}`
    const id = await createEntity(request, token, '/api/sales/shipment-statuses', {
      value: `qa_shipment_${stamp}_${padded}`,
      label: name,
    })
    return { id, name }
  })
}

async function createAddresses(
  request: APIRequestContext,
  token: string,
  customerId: string,
  stamp: number,
  scope: FixtureScope,
): Promise<FixtureOption[]> {
  return createBatched(52, async (index) => {
    const padded = String(index).padStart(3, '0')
    const name = `QA Address ${stamp} ${padded}`
    const id = await createEntity(request, token, '/api/customers/addresses', {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      entityId: customerId,
      name,
      addressLine1: `${padded} Select Street`,
      city: 'Warsaw',
      country: 'PL',
    })
    return { id, name }
  })
}

async function pickOutsideFirstPage(
  request: APIRequestContext,
  token: string,
  path: string,
  fixtures: FixtureOption[],
  pageSize: number,
): Promise<FixtureOption> {
  const separator = path.includes('?') ? '&' : '?'
  const response = await apiRequest(request, 'GET', `${path}${separator}page=1&pageSize=${pageSize}`, { token })
  expect(response.ok(), `Failed to list ${path}: ${response.status()}`).toBeTruthy()
  const payload = await readJsonSafe(response)
  const firstPageIds = new Set(
    (Array.isArray((payload as Record<string, unknown>).items)
      ? ((payload as Record<string, unknown>).items as Array<Record<string, unknown>>)
      : [])
      .map((item) => (typeof item.id === 'string' ? item.id : null))
      .filter((id): id is string => Boolean(id)),
  )
  const selected = fixtures.find((fixture) => !firstPageIds.has(fixture.id))
  expect(selected, `Expected a created option to be outside the first ${path} page`).toBeTruthy()
  return selected as FixtureOption
}

async function deleteByQuery(
  request: APIRequestContext,
  token: string,
  path: string,
  id: string | null,
): Promise<void> {
  if (!id) return
  try {
    await apiRequest(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, { token })
  } catch {
    return
  }
}

async function expectDialogComboboxLabel(dialog: Locator, label: string): Promise<void> {
  await expect(dialog.getByRole('combobox').filter({ hasText: label }).first()).toBeVisible()
}

async function expectDialogLookupLabel(dialog: Locator, label: string): Promise<void> {
  await expect(dialog.getByRole('button').filter({ hasText: label }).first()).toBeVisible()
}

test.describe('TC-SALES-031: Sales edit dialogs prefill saved async selects', () => {
  test('order detail edit dialogs show saved select labels outside capped option pages', async ({ page, request }) => {
    test.slow()
    test.setTimeout(240_000)

    const bootstrapToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminScope = getTokenScope(bootstrapToken)
    const stamp = Date.now()
    const testUserEmail = `qa-sales-select-${stamp}@acme.com`
    const testUserPassword = `QaSales1!${stamp}`
    const taxRates: FixtureOption[] = []
    const shippingMethods: FixtureOption[] = []
    const shipmentStatuses: FixtureOption[] = []
    const addresses: FixtureOption[] = []
    let token: string | null = null
    let testUserId: string | null = null
    let customerId: string | null = null
    let orderId: string | null = null
    let orderLineId: string | null = null
    let adjustmentId: string | null = null
    let shipmentId: string | null = null

    try {
      testUserId = await createUserFixture(request, bootstrapToken, {
        email: testUserEmail,
        password: testUserPassword,
        organizationId: adminScope.organizationId,
        roles: ['employee'],
        name: `QA Sales Select ${stamp}`,
      })
      await setUserAclVisibility(request, superadminToken, {
        userId: testUserId,
        features: ['customers.*', 'sales.*'],
        organizations: [adminScope.organizationId],
      })
      token = await getAuthToken(request, testUserEmail, testUserPassword)
      customerId = await createCompanyFixture(request, token, `QA Sales Select Customer ${stamp}`)
      addresses.push(...(await createAddresses(request, token, customerId, stamp, adminScope)))
      const selectedAddress = await pickOutsideFirstPage(
        request,
        token,
        `/api/customers/addresses?entityId=${encodeURIComponent(customerId)}`,
        addresses,
        50,
      )
      taxRates.push(...(await createTaxRates(request, token, stamp)))
      shippingMethods.push(...(await createShippingMethods(request, token, stamp)))
      shipmentStatuses.push(...(await createShipmentStatuses(request, token, stamp)))
      const selectedTaxRate = await pickOutsideFirstPage(request, token, '/api/sales/tax-rates', taxRates, 200)
      const selectedShippingMethod = await pickOutsideFirstPage(
        request,
        token,
        '/api/sales/shipping-methods',
        shippingMethods,
        50,
      )
      const selectedShipmentStatus = await pickOutsideFirstPage(
        request,
        token,
        '/api/sales/shipment-statuses',
        shipmentStatuses,
        100,
      )

      orderId = await createEntity(request, token, '/api/sales/orders', {
        currencyCode: 'USD',
        customerEntityId: customerId,
        shippingAddressId: selectedAddress.id,
        billingAddressId: selectedAddress.id,
      })
      orderLineId = await createOrderLineFixture(request, token, orderId, {
        name: `QA Sales Select Line ${stamp}`,
        quantity: 2,
        unitPriceNet: 10,
        unitPriceGross: 12,
        currencyCode: 'USD',
        metadata: { taxRateId: selectedTaxRate.id },
        taxRate: 19,
      })
      adjustmentId = await createEntity(request, token, '/api/sales/order-adjustments', {
        orderId,
        label: `QA Sales Select Adjustment ${stamp}`,
        kind: 'surcharge',
        amountNet: 5,
        amountGross: 5.95,
        currencyCode: 'USD',
        metadata: { taxRateId: selectedTaxRate.id, taxRate: 19 },
      })
      shipmentId = await createEntity(request, token, '/api/sales/shipments', {
        orderId,
        shipmentNumber: `QA-SHIP-${stamp}`,
        shippingMethodId: selectedShippingMethod.id,
        statusEntryId: selectedShipmentStatus.id,
        currencyCode: 'USD',
        items: [{ orderLineId, quantity: 1 }],
      })

      await loginWithCredentials(page, testUserEmail, testUserPassword)
      await page.goto(`/backend/sales/orders/${encodeURIComponent(orderId)}`, { waitUntil: 'commit' })
      await expect(page.getByText(`QA Sales Select Line ${stamp}`, { exact: true }).first()).toBeVisible()

      await page.getByText(`QA Sales Select Line ${stamp}`, { exact: true }).click()
      let dialog = page.getByRole('dialog')
      await expect(dialog.getByRole('heading', { name: 'Edit line' })).toBeVisible()
      await expectDialogComboboxLabel(dialog, selectedTaxRate.name)
      await page.keyboard.press('Escape')
      await expect(dialog).not.toBeVisible()

      await page.getByRole('button', { name: 'Adjustments' }).click()
      await expect(page.getByText(`QA Sales Select Adjustment ${stamp}`, { exact: true }).first()).toBeVisible()
      await page.getByText(`QA Sales Select Adjustment ${stamp}`, { exact: true }).click()
      dialog = page.getByRole('dialog')
      await expect(dialog.getByRole('heading', { name: 'Edit adjustment' })).toBeVisible()
      await expectDialogComboboxLabel(dialog, selectedTaxRate.name)
      await page.keyboard.press('Escape')
      await expect(dialog).not.toBeVisible()

      await page.getByRole('button', { name: 'Shipments' }).click()
      const shipmentCard = page
        .getByText(`Shipment QA-SHIP-${stamp}`, { exact: false })
        .locator('xpath=ancestor::div[contains(@class,"rounded")]')
        .first()
      await expect(shipmentCard).toBeVisible()
      await shipmentCard.getByRole('button').first().click()
      dialog = page.getByRole('dialog')
      await expect(dialog.getByRole('heading', { name: 'Edit shipment' })).toBeVisible()
      await expectDialogLookupLabel(dialog, selectedShippingMethod.name)
      await expectDialogLookupLabel(dialog, selectedShipmentStatus.name)
      await page.keyboard.press('Escape')
      await expect(dialog).not.toBeVisible()

      await page.getByRole('button', { name: 'Addresses' }).click()
      const shippingPanel = page
        .getByText('Shipping address', { exact: true })
        .locator('xpath=ancestor::div[contains(@class,"rounded")]')
        .first()
      await expect(shippingPanel.getByRole('switch', { name: 'Define new address' })).toBeChecked()
      await shippingPanel.getByRole('switch', { name: 'Define new address' }).click()
      await expect(shippingPanel.getByRole('combobox').filter({ hasText: selectedAddress.name }).first()).toBeVisible()
    } finally {
      if (token) {
        await deleteByQuery(request, token, '/api/sales/shipments', shipmentId)
        await deleteByQuery(request, token, '/api/sales/order-adjustments', adjustmentId)
        await deleteByQuery(request, token, '/api/sales/order-lines', orderLineId)
        await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
        for (const address of addresses.reverse()) {
          await deleteEntityIfExists(request, token, '/api/customers/addresses', address.id)
        }
        await deleteEntityIfExists(request, token, '/api/customers/companies', customerId)
        for (const status of shipmentStatuses.reverse()) {
          await deleteByQuery(request, token, '/api/sales/shipment-statuses', status.id)
        }
        for (const method of shippingMethods.reverse()) {
          await deleteByQuery(request, token, '/api/sales/shipping-methods', method.id)
        }
        for (const taxRate of taxRates.reverse()) {
          await deleteByQuery(request, token, '/api/sales/tax-rates', taxRate.id)
        }
      }
      await deleteUserIfExists(request, bootstrapToken, testUserId)
    }
  })
})
