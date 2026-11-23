import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectConflictBody, putWithLock } from '@open-mercato/core/helpers/integration/optimisticLockUi'

const ORDERS = '/api/sales/orders'
const PAYMENTS = '/api/sales/payments'

const languages = {
  en: {
    tab: 'Payments', method: 'Method', actions: 'Actions', open: 'Open actions',
    edit: 'Edit payment', delete: 'Delete payment',
    totals: { 'Grand total (net)': 100, 'Grand total (gross)': 123, Outstanding: 98, Paid: 25 },
  },
  pl: {
    tab: 'Płatności', method: 'Metoda', actions: 'Akcje', open: 'Otwórz akcje',
    edit: 'Edytuj płatność', delete: 'Usuń płatność',
    totals: { 'Razem (netto)': 100, 'Razem (brutto)': 123, 'Do zapłaty': 98, Zapłacono: 25 },
  },
} as const

type Order = Record<string, unknown> & { updatedAt: string }
type Payment = Record<string, unknown> & { updated_at: string }

async function readSingleRecord<RecordType>(request: APIRequestContext, token: string, path: string) {
  const response = await apiRequest(request, 'GET', path, { token })
  expect(response.status(), `GET ${path}`).toBe(200)
  const body = await readJsonSafe<{ items: [RecordType] }>(response)
  expect(body?.items, `GET ${path} should return exactly one fixture`).toHaveLength(1)
  return body!.items[0]
}

test('TC-SALES-9594: scoped actors see localized payment metadata and preserve a concurrent order edit', async ({ page, request }, testInfo) => {
  const bootstrap = await getAuthToken(request, 'superadmin')
  const { tenantId } = getTokenContext(bootstrap)
  const marker = `qa9594-${randomUUID()}`
  const password = `QaPayment1!${marker}`
  const cleanup: (() => Promise<void>)[] = []

  function deleteOnExit(path: string, token = bootstrap, data?: Record<string, unknown>, selectedOrgId?: string) {
    cleanup.push(async () => {
      const response = selectedOrgId
        ? await apiRequestWithSelectedOrg(request, 'DELETE', path, { token, data, selectedOrgId })
        : await apiRequest(request, 'DELETE', path, { token, data, retryTransport: false })
      expect(response.ok(), `Cleanup DELETE ${path}: ${response.status()}`).toBe(true)
    })
  }

  async function createInOrganization(path: string, organizationId: string, name: string, code: string) {
    const response = await apiRequestWithSelectedOrg(request, 'POST', path, {
      token: bootstrap, selectedOrgId: organizationId, data: { name, code },
    })
    expect(response.status(), `Create ${path}: ${await response.text()}`).toBe(201)
    const id = expectId((await readJsonSafe<{ id?: string }>(response))?.id, `Created ${path} ID`)
    deleteOnExit(`${path}?id=${id}`, bootstrap, undefined, organizationId)
    return id
  }

  try {
    const organizationId = await createOrganizationFixture(request, bootstrap, { tenantId, name: `${marker} Sales` })
    deleteOnExit('/api/directory/organizations', bootstrap, { id: organizationId })
    const siblingId = await createOrganizationFixture(request, bootstrap, { tenantId, name: `${marker} Sibling` })
    deleteOnExit('/api/directory/organizations', bootstrap, { id: siblingId })

    const salesRoleId = await createRoleFixture(request, bootstrap, { tenantId, name: `${marker}-sales` })
    deleteOnExit(`/api/auth/roles?id=${salesRoleId}`)
    const deniedRoleId = await createRoleFixture(request, bootstrap, { tenantId, name: `${marker}-denied` })
    deleteOnExit(`/api/auth/roles?id=${deniedRoleId}`)
    await setRoleAclFeatures(request, bootstrap, {
      roleId: salesRoleId,
      organizations: [organizationId],
      features: [
        'sales.orders.view', 'sales.orders.manage', 'sales.payments.manage',
        'sales.channels.view', 'sales.settings.view', 'customers.people.view', 'catalog.products.view',
        'currencies.view', 'payment_gateways.view',
      ],
    })
    await setRoleAclFeatures(request, bootstrap, { roleId: deniedRoleId, organizations: [organizationId], features: [] })

    const [actorEmail, editorEmail, deniedEmail] = ['actor', 'editor', 'denied'].map((name) => `${marker}-${name}@example.com`)
    for (const [email, roleId] of [[actorEmail, salesRoleId], [editorEmail, salesRoleId], [deniedEmail, deniedRoleId]]) {
      const userId = await createUserFixture(request, bootstrap, { email, password, organizationId, roles: [roleId] })
      deleteOnExit(`/api/auth/users?id=${userId}`)
    }

    const methodName = `${marker} Local payment`
    const methodCode = `${marker}-local`
    const siblingMethod = `${marker} Sibling payment`
    const methodId = await createInOrganization('/api/sales/payment-methods', organizationId, methodName, methodCode)
    await createInOrganization('/api/sales/payment-methods', siblingId, siblingMethod, `${marker}-sibling`)
    const channelId = await createInOrganization('/api/sales/channels', organizationId, `${marker} Channel`, marker)

    const actor = await getAuthToken(page.request, actorEmail, password)
    const editor = await getAuthToken(request, editorEmail, password)
    const denied = await getAuthToken(request, deniedEmail, password)
    const orderResponse = await apiRequest(request, 'POST', ORDERS, {
      token: actor, retryTransport: false,
      data: {
        channelId, currencyCode: 'PLN',
        lines: [{ name: marker, currencyCode: 'PLN', quantity: 1, unitPriceNet: 100, unitPriceGross: 123, taxRate: 23 }],
      },
    })
    expect(orderResponse.status(), `Order fixture: ${await orderResponse.text()}`).toBe(201)
    const orderId = expectId((await readJsonSafe<{ id?: string }>(orderResponse))?.id, 'Created order ID')
    deleteOnExit(ORDERS, actor, { id: orderId })
    const paymentResponse = await apiRequest(request, 'POST', PAYMENTS, {
      token: actor, retryTransport: false,
      data: { orderId, paymentMethodId: methodId, amount: 25, currencyCode: 'PLN', paymentReference: marker },
    })
    expect(paymentResponse.status(), `Payment fixture: ${await paymentResponse.text()}`).toBe(201)
    const paymentId = expectId((await readJsonSafe<{ id?: string }>(paymentResponse))?.id, 'Created payment ID')
    deleteOnExit(PAYMENTS, actor, { id: paymentId, orderId })

    const readState = async () => ({
      order: await readSingleRecord<Order>(request, actor, `${ORDERS}?id=${orderId}`),
      payment: await readSingleRecord<Payment>(request, actor, `${PAYMENTS}?orderId=${orderId}`),
    })
    const before = await readState()
    expect(before.order).toMatchObject({
      id: orderId, channelId, organizationId, grandTotalNetAmount: 100, taxTotalAmount: 23,
      grandTotalGrossAmount: 123, paidTotalAmount: 25, outstandingAmount: 98,
    })
    expect(before.payment).toMatchObject({
      id: paymentId, payment_method_id: methodId, payment_method_name: methodName, payment_method_code: methodCode,
    })
    expect(Number(before.payment.amount)).toBe(25)
    const initialVersion = new Date(before.order.updatedAt).toISOString()

    const paymentEdit = { id: paymentId, paymentReference: `${marker}-edited` }
    const deniedWrite = await putWithLock(request, denied, PAYMENTS, paymentEdit, initialVersion)
    expect(deniedWrite.status()).toBe(403)
    expect(await readState()).toEqual(before)

    const customerReference = `${marker}-second-actor`
    const secondWrite = await putWithLock(request, editor, ORDERS, { id: orderId, customerReference }, initialVersion)
    expect(secondWrite.status()).toBe(200)
    const edited = await readState()
    const editedVersion = new Date(edited.order.updatedAt).toISOString()
    expect(editedVersion).not.toBe(initialVersion)
    expect(edited).toEqual({ ...before, order: { ...before.order, customerReference, updatedAt: edited.order.updatedAt } })

    const stale = await putWithLock(request, actor, PAYMENTS, paymentEdit, initialVersion)
    expect(await expectConflictBody(stale)).toMatchObject({
      expectedUpdatedAt: initialVersion, currentUpdatedAt: editedVersion,
    })
    expect(await readState()).toEqual(edited)

    const retry = await putWithLock(request, actor, PAYMENTS, paymentEdit, editedVersion)
    expect(retry.status()).toBe(200)
    const after = await readState()
    expect(after.payment.updated_at).not.toBe(edited.payment.updated_at)
    expect(after).toEqual({
      order: { ...edited.order, updatedAt: after.order.updatedAt },
      payment: { ...edited.payment, payment_reference: paymentEdit.paymentReference, updated_at: after.payment.updated_at },
    })

    for (const locale of ['en', 'pl'] as const) {
      const labels = languages[locale]
      const money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'PLN' })
      expect((await page.request.post('/api/auth/locale', { data: { locale } })).status()).toBe(200)
      await page.goto(`/backend/sales/orders/${orderId}`, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('html')).toHaveAttribute('lang', locale)
      await page.getByRole('button', { name: labels.tab, exact: true }).click()
      const reference = page.getByRole('cell', { name: paymentEdit.paymentReference, exact: true })
      const table = page.getByRole('table').filter({ has: reference })
      const row = table.getByRole('row').filter({ has: reference })
      await expect(table.getByRole('columnheader', { name: labels.method, exact: true })).toBeVisible()
      await expect(table.getByRole('columnheader', { name: labels.actions, exact: true })).toBeVisible()
      await expect(row.getByRole('cell', { name: methodName, exact: true })).toBeVisible()
      await expect(table.getByText(siblingMethod, { exact: true })).toHaveCount(0)
      await expect(row.getByRole('cell', { name: money.format(25), exact: true })).toBeVisible()
      for (const [label, value] of Object.entries(labels.totals)) {
        const totalRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: label, exact: true }) })
        await expect(totalRow.getByRole('cell', { name: money.format(value), exact: true })).toBeVisible()
      }

      const actions = row.getByRole('button', { name: labels.open, exact: true })
      await actions.press('Enter')
      const editItem = page.getByRole('menuitem', { name: labels.edit, exact: true })
      const deleteItem = page.getByRole('menuitem', { name: labels.delete, exact: true })
      await expect(editItem).toBeVisible()
      await expect(deleteItem).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(editItem).toBeHidden()
      await expect(deleteItem).toBeHidden()
      await expect(actions).toBeFocused()
      await testInfo.attach(`payments-${locale}`, { body: await table.screenshot(), contentType: 'image/png' })
    }
  } finally {
    for (const dispose of cleanup.reverse()) {
      try {
        await dispose()
      } catch (error) {
        expect.soft(String(error), 'Fixture cleanup should succeed').toBe('')
      }
    }
  }
})
