import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createShipmentFixture, deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { hashAuthToken } from '@open-mercato/core/modules/auth/lib/tokenHash'
import { deserializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

export const integrationMeta = { dependsOnModules: ['sales', 'customers', 'entities'] }

const salesHost = 'sales:sales_document_address'
const customerHost = 'customers:customer_address'
const definitions = '/api/entities/definitions'
const addresses = '/api/sales/document-addresses'
const customerAddresses = '/api/customers/addresses'
const undoPath = '/api/audit_logs/audit-logs/actions/undo'
const postalAddress = { addressLine1: '10 Address Lane', city: 'London', country: 'GB' }
const seedLine = { currencyCode: 'USD', quantity: 1, name: 'QA address line', unitPriceNet: 10, unitPriceGross: 10 }

type Item = Record<string, unknown> & { id?: string }

async function create(
  request: APIRequestContext, token: string, path: string, data: Record<string, unknown>,
) {
  const response = await apiRequest(request, 'POST', path, { token, data })
  expect(response.status(), path).toBe(201)
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, path)
}

async function readItem(request: APIRequestContext, token: string, path: string, id: string) {
  const response = await apiRequest(request, 'GET', path, { token })
  expect(response.status(), path).toBe(200)
  return (await readJsonSafe<{ items?: Item[] }>(response))?.items?.find((item) => item.id === id)
}

async function addField(request: APIRequestContext, token: string, entityId: string, key: string) {
  const response = await apiRequest(request, 'POST', definitions, {
    token,
    data: { entityId, key, kind: 'text', label: 'QA delivery instruction', formEditable: true },
  })
  expect(response.ok()).toBeTruthy()
}

async function deleteField(request: APIRequestContext, token: string, entityId: string, key: string) {
  await apiRequest(request, 'DELETE', `${definitions}?${new URLSearchParams({ entityId, key })}`, { token }).catch(() => undefined)
}

async function undo(request: APIRequestContext, token: string, action: APIResponse) {
  const undoToken = deserializeOperationMetadata(action.headers()['x-om-operation'])?.undoToken
  expect(undoToken).toBeTruthy()
  return apiRequest(request, 'POST', undoPath, { token, data: { undoToken } })
}

for (const kind of ['order', 'quote'] as const) {
  test(`TC-SALES-5231: ${kind} has separate private primary address values`, async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const key = `qa_address_${randomUUID().replaceAll('-', '')}`
    const marker = `private instructions ${randomUUID()}`
    const path = `/api/sales/${kind}s`
    const billingAddressSnapshot = { ...postalAddress, customValues: 'legacy integration key', phone: '+442011111111' }
    let id: string | null = null
    try {
      await addField(request, token, salesHost, key)
      id = await create(request, token, path, {
        currencyCode: 'USD',
        lines: [seedLine],
        billingAddressSnapshot,
        shippingAddressSnapshot: { ...postalAddress, addressLine1: '20 Address Lane' },
        billingAddressCustomValues: { [key]: marker },
        shippingAddressCustomValues: { [key]: 'Initial shipping' },
      })
      const detail = `${path}?id=${id}`
      const before = await readItem(request, token, detail, id)
      expect(before?.billingAddressCustomValues).toEqual({ [key]: marker })
      expect(before?.shippingAddressCustomValues).toEqual({ [key]: 'Initial shipping' })
      expect(before?.billingAddressSnapshot).toEqual(billingAddressSnapshot)
      const version = String(before?.updatedAt)
      const updated = await apiRequest(request, 'PUT', path, {
        token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: version },
        data: { id, shippingAddressCustomValues: { [key]: 'Updated shipping' } },
      })
      expect(updated.status()).toBe(200)
      const stale = await apiRequest(request, 'PUT', path, {
        token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: version },
        data: { id, shippingAddressCustomValues: { [key]: 'Stale' } },
      })
      expect(stale.status()).toBe(409)
      const after = await readItem(request, token, detail, id)
      expect(after?.billingAddressCustomValues).toEqual({ [key]: marker })
      expect(after?.shippingAddressCustomValues).toEqual({ [key]: 'Updated shipping' })
      expect(after?.billingAddressSnapshot).toEqual(billingAddressSnapshot)
      const billingAgain = await apiRequest(request, 'PUT', path, {
        token, data: { id, billingAddressCustomValues: { [key]: `${marker} edited` } },
      })
      expect(billingAgain.status()).toBe(200)
      expect((await undo(request, token, updated)).status()).toBe(200)
      const afterUndo = await readItem(request, token, detail, id)
      expect(afterUndo?.billingAddressCustomValues).toEqual({ [key]: `${marker} edited` })
      expect(afterUndo?.shippingAddressCustomValues).toEqual({ [key]: 'Initial shipping' })
      const earlierShipping = await apiRequest(request, 'PUT', path, {
        token, data: { id, shippingAddressCustomValues: { [key]: 'Earlier shipping' } },
      })
      expect(earlierShipping.status()).toBe(200)
      const latestShipping = await apiRequest(request, 'PUT', path, {
        token, data: { id, shippingAddressCustomValues: { [key]: 'Latest shipping' } },
      })
      expect(latestShipping.status()).toBe(200)
      expect((await undo(request, token, earlierShipping)).status()).toBe(409)
      expect((await readItem(request, token, detail, id))?.shippingAddressCustomValues).toEqual({ [key]: 'Latest shipping' })
      const grid = await apiRequest(request, 'GET', `${path}?pageSize=100`, { token })
      expect(grid.status()).toBe(200)
      expect(await grid.text()).not.toContain(marker)
      const exported = await apiRequest(request, 'GET', `${detail}&format=json`, { token })
      expect(exported.status()).toBe(200)
      expect(await exported.text()).not.toContain(marker)
      if (kind === 'quote') {
        const publicToken = randomUUID()
        await withClient(async (client) => {
          const changed = await client.query(
            "update sales_quotes set acceptance_token = $2, status = 'sent' where id = $1",
            [id, hashAuthToken(publicToken)],
          )
          expect(changed.rowCount).toBe(1)
        })
        const shared = await request.get(`/api/sales/quotes/public/${publicToken}`)
        expect(shared.status()).toBe(200)
        expect(await shared.text()).not.toContain(marker)
      }
      const clear = await apiRequest(request, 'PUT', path, {
        token, data: { id, billingAddressSnapshot: null, shippingAddressCustomValues: { [key]: null } },
      })
      expect(clear.status()).toBe(200)
      const cleared = await readItem(request, token, detail, id)
      expect(cleared?.billingAddressCustomValues).toBeUndefined()
      expect(cleared?.shippingAddressCustomValues).toBeUndefined()
    } finally {
      await deleteSalesEntityIfExists(request, token, path, id)
      await deleteField(request, token, salesHost, key)
    }
  })
}

test('TC-SALES-5231: additional address locks independently, restores values on undo, and stays out of exports', async ({ request }) => {
  test.slow()
  const token = await getAuthToken(request, 'admin')
  const key = `qa_additional_${randomUUID().replaceAll('-', '')}`
  const marker = `private extra ${randomUUID()}`
  let quoteId: string | null = null
  try {
    await addField(request, token, salesHost, key)
    quoteId = await create(request, token, '/api/sales/quotes', { currencyCode: 'USD' })
    const parent = { documentId: quoteId, documentKind: 'quote' }
    const path = `${addresses}?${new URLSearchParams(parent)}`
    const addressId = await create(request, token, addresses, {
      ...parent, ...postalAddress, customValues: { [key]: marker },
    })
    const before = await readItem(request, token, path, addressId)
    expect(before?.customValues).toEqual({ [key]: marker })
    const headers = { [OPTIMISTIC_LOCK_HEADER_NAME]: String(before?.updated_at) }
    const updated = await apiRequest(request, 'PUT', addresses, {
      token, headers, data: { id: addressId, ...parent, customValues: { [key]: 'Edited' } },
    })
    expect(updated.status()).toBe(200)
    const row = await readItem(request, token, path, addressId)
    expect(row?.customValues).toEqual({ [key]: 'Edited' })
    expect(row?.address_line1).toBe(postalAddress.addressLine1)
    const stale = await apiRequest(request, 'DELETE', addresses, { token, headers, data: { id: addressId, ...parent } })
    expect(stale.status()).toBe(409)
    const postalUpdate = await apiRequest(request, 'PUT', addresses, {
      token, data: { id: addressId, ...parent, ...postalAddress, city: 'York' },
    })
    expect(postalUpdate.status()).toBe(200)
    const laterBag = await apiRequest(request, 'PUT', addresses, {
      token, data: { id: addressId, ...parent, customValues: { [key]: 'Latest extra' } },
    })
    expect(laterBag.status()).toBe(200)
    expect((await undo(request, token, postalUpdate)).status()).toBe(200)
    expect((await undo(request, token, updated)).status()).toBe(409)
    const updatedRow = await readItem(request, token, path, addressId)
    expect(updatedRow?.city).toBe(postalAddress.city)
    expect(updatedRow?.customValues).toEqual({ [key]: 'Latest extra' })
    const deleted = await apiRequest(request, 'DELETE', addresses, {
      token,
      headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: String(updatedRow?.updated_at) },
      data: { id: addressId, ...parent },
    })
    expect(deleted.status()).toBe(200)
    expect(await readItem(request, token, path, addressId)).toBeUndefined()
    const undone = await undo(request, token, deleted)
    expect(undone.status()).toBe(200)
    expect((await readItem(request, token, path, addressId))?.customValues).toEqual({ [key]: 'Latest extra' })
    const exported = await apiRequest(request, 'GET', `${path}&format=json`, { token })
    expect(exported.status()).toBe(200)
    expect(await exported.text()).not.toContain(key)
  } finally {
    await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    await deleteField(request, token, salesHost, key)
  }
})

test('TC-SALES-5231: scoped CRM selection freezes values through quote conversion', async ({ request }) => {
  test.slow()
  const token = await getAuthToken(request, 'admin')
  const suffix = randomUUID()
  const key = `qa_customer_${suffix.replaceAll('-', '')}`
  let customerId: string | null = null
  let otherCustomerId: string | null = null
  let quoteId: string | null = null
  let orderId: string | null = null
  let shipmentId: string | null = null
  try {
    await addField(request, token, customerHost, key)
    await addField(request, token, salesHost, key)
    customerId = await createPersonFixture(request, token, { firstName: 'Address', lastName: 'Owner', displayName: `Address owner ${suffix}` })
    otherCustomerId = await createPersonFixture(request, token, { firstName: 'Other', lastName: 'Owner', displayName: `Other owner ${suffix}` })
    const addressId = await create(request, token, customerAddresses, {
      ...postalAddress, entityId: customerId, customValues: { [key]: 'Frozen source' },
    })
    const foreignAddressId = await create(request, token, customerAddresses, {
      ...postalAddress, entityId: otherCustomerId, customValues: { [key]: 'Other source' },
    })
    quoteId = await create(request, token, '/api/sales/quotes', {
      currencyCode: 'USD', customerEntityId: customerId, lines: [seedLine],
      shippingAddressId: addressId, copyShippingAddressCustomValues: true,
    })
    const quoteDetail = `/api/sales/quotes?id=${quoteId}`
    expect((await readItem(request, token, quoteDetail, quoteId))?.shippingAddressCustomValues).toEqual({ [key]: 'Frozen source' })
    const extraId = await create(request, token, addresses, {
      ...postalAddress, documentId: quoteId, documentKind: 'quote', customerAddressId: addressId,
      copyCustomerAddressCustomValues: true, customValues: { [key]: 'Additional override' },
    })
    const wrongOwner = await apiRequest(request, 'PUT', '/api/sales/quotes', {
      token, data: { id: quoteId, shippingAddressId: foreignAddressId, copyShippingAddressCustomValues: true },
    })
    expect(wrongOwner.status()).toBe(404)
    const crmEdit = await apiRequest(request, 'PUT', customerAddresses, {
      token, data: { id: addressId, customValues: { [key]: 'Updated source' } },
    })
    expect(crmEdit.status()).toBe(200)
    const ordinarySave = await apiRequest(request, 'PUT', '/api/sales/quotes', {
      token, data: { id: quoteId, shippingAddressId: addressId },
    })
    expect(ordinarySave.status()).toBe(200)
    expect((await readItem(request, token, quoteDetail, quoteId))?.shippingAddressCustomValues).toEqual({ [key]: 'Frozen source' })
    const reselected = await apiRequest(request, 'PUT', '/api/sales/quotes', {
      token, data: { id: quoteId, shippingAddressId: addressId, copyShippingAddressCustomValues: true },
    })
    expect(reselected.status()).toBe(200)
    expect((await readItem(request, token, quoteDetail, quoteId))?.shippingAddressCustomValues).toEqual({ [key]: 'Updated source' })
    const converted = await apiRequest(request, 'POST', '/api/sales/quotes/convert', { token, data: { quoteId } })
    expect(converted.status()).toBe(200)
    orderId = expectId((await readJsonSafe<{ orderId?: string }>(converted))?.orderId, 'converted order')
    const order = await readItem(request, token, `/api/sales/orders?id=${orderId}`, orderId)
    expect(order?.shippingAddressCustomValues).toEqual({ [key]: 'Updated source' })
    expect(order?.shippingAddressSnapshot).not.toHaveProperty('customValues')
    const convertedExtra = await readItem(request, token, `${addresses}?documentId=${orderId}&documentKind=order`, extraId)
    expect(convertedExtra?.customValues).toEqual({ [key]: 'Additional override' })
    const lines = await apiRequest(request, 'GET', `/api/sales/order-lines?orderId=${orderId}`, { token })
    expect(lines.status()).toBe(200)
    const lineId = expectId((await readJsonSafe<{ items?: Item[] }>(lines))?.items?.[0]?.id, 'converted order line')
    shipmentId = await createShipmentFixture(request, token, orderId, [{ orderLineId: lineId, quantity: 1 }])
    const shipment = await readItem(request, token, `/api/sales/shipments?orderId=${orderId}`, shipmentId)
    expect(shipment?.metadata).toMatchObject({ shipmentAddressSnapshot: { addressLine1: postalAddress.addressLine1 } })
    expect(JSON.stringify(shipment)).not.toContain('Updated source')
  } finally {
    await deleteSalesEntityIfExists(request, token, '/api/sales/shipments', shipmentId)
    await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    await deleteEntityIfExists(request, token, '/api/customers/people', customerId)
    await deleteEntityIfExists(request, token, '/api/customers/people', otherCustomerId)
    await deleteField(request, token, salesHost, key)
    await deleteField(request, token, customerHost, key)
  }
})
