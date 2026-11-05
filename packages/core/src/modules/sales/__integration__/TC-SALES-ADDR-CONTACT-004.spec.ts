import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

type DocumentKind = 'orders' | 'quotes'

type PersonFixture = { entityId: string; personId: string }

async function createPerson(request: APIRequestContext, token: string, label: string): Promise<PersonFixture> {
  const stamp = Date.now()
  const response = await apiRequest(request, 'POST', '/api/customers/people', {
    token,
    data: { firstName: 'QA', lastName: `${label} ${stamp}`, displayName: `QA ${label} ${stamp}` },
  })
  expect(response.ok(), `Failed POST /api/customers/people: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ id?: string; personId?: string }>(response)
  expect(body?.id, 'person response should include the customer entity id').toBeTruthy()
  expect(body?.personId, 'person response should include the person profile id').toBeTruthy()
  return { entityId: body!.id!, personId: body!.personId! }
}

async function createAddress(
  request: APIRequestContext,
  token: string,
  entityId: string,
  addressLine1: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/customers/addresses', {
    token,
    data: { entityId, name: addressLine1, addressLine1, city: 'Warsaw', postalCode: '00-001', country: 'PL' },
  })
  expect(response.ok(), `Failed POST /api/customers/addresses: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(body?.id, 'address response should include an id').toBeTruthy()
  return body!.id!
}

async function createDocument(
  request: APIRequestContext,
  token: string,
  kind: DocumentKind,
  data: Record<string, unknown>,
): Promise<string> {
  const payload: Record<string, unknown> = { currencyCode: 'USD', ...data }
  if (kind === 'orders') {
    payload.lines = [
      { currencyCode: 'USD', quantity: 1, name: `QA seed line ${Date.now()}`, unitPriceNet: 0, unitPriceGross: 0 },
    ]
  }
  const response = await apiRequest(request, 'POST', `/api/sales/${kind}`, { token, data: payload })
  expect(response.ok(), `Failed POST /api/sales/${kind}: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ id?: string; orderId?: string; quoteId?: string }>(response)
  const id = body?.id ?? body?.orderId ?? body?.quoteId
  expect(id, `POST /api/sales/${kind} should return an id`).toBeTruthy()
  return id as string
}

async function updateDocument(
  request: APIRequestContext,
  token: string,
  kind: DocumentKind,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', `/api/sales/${kind}`, { token, data: { id, ...data } })
  expect(response.status(), `PUT /api/sales/${kind} should succeed`).toBe(200)
}

async function readDocument(
  request: APIRequestContext,
  token: string,
  kind: DocumentKind,
  id: string,
): Promise<Record<string, unknown>> {
  const response = await apiRequest(request, 'GET', `/api/sales/${kind}?id=${encodeURIComponent(id)}`, { token })
  expect(response.status(), `GET /api/sales/${kind}?id=... should return 200`).toBe(200)
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
  const item = body?.items?.[0]
  expect(item, 'response should include the requested document').toBeTruthy()
  return item as Record<string, unknown>
}

function snapshotContactId(item: Record<string, unknown>): string | null {
  const snapshot = item.customerSnapshot as { contact?: { id?: string } | null } | null | undefined
  return snapshot?.contact?.id ?? null
}

test.describe('TC-SALES-ADDR-CONTACT-004: re-saving the assigned customer keeps contact and addresses', () => {
  for (const kind of ['orders', 'quotes'] as const) {
    test(`${kind}: only a real customer change resets the contact and addresses`, async ({ request }) => {
      const token = await getAuthToken(request)
      const customerIds: string[] = []
      const addressIds: string[] = []
      let documentId: string | null = null
      try {
        const current = await createPerson(request, token, 'Current')
        customerIds.push(current.entityId)
        const other = await createPerson(request, token, 'Other')
        customerIds.push(other.entityId)
        const billingAddressId = await createAddress(request, token, current.entityId, '1 Billing Street')
        addressIds.push(billingAddressId)
        const shippingAddressId = await createAddress(request, token, current.entityId, '2 Shipping Street')
        addressIds.push(shippingAddressId)

        documentId = await createDocument(request, token, kind, {
          customerEntityId: current.entityId,
          customerContactId: current.personId,
          billingAddressId,
          shippingAddressId,
        })
        const before = await readDocument(request, token, kind, documentId)
        expect(before).toMatchObject({
          customerEntityId: current.entityId,
          customerContactId: current.personId,
          billingAddressId,
          shippingAddressId,
        })
        expect(before.billingAddressSnapshot).toMatchObject({ addressLine1: '1 Billing Street' })
        expect(before.shippingAddressSnapshot).toMatchObject({ addressLine1: '2 Shipping Street' })

        await updateDocument(request, token, kind, documentId, {
          customerEntityId: current.entityId,
          metadata: { customerEmail: 'qa-resave@example.com' },
        })
        const resaved = await readDocument(request, token, kind, documentId)
        expect(resaved).toMatchObject({
          customerEntityId: current.entityId,
          customerContactId: current.personId,
          billingAddressId,
          shippingAddressId,
        })
        expect(resaved.billingAddressSnapshot ?? null).toEqual(before.billingAddressSnapshot ?? null)
        expect(resaved.shippingAddressSnapshot ?? null).toEqual(before.shippingAddressSnapshot ?? null)
        expect(snapshotContactId(resaved)).toBe(current.personId)

        const upperCaseCustomerId = current.entityId.toUpperCase()
        expect(upperCaseCustomerId, 'customer id should contain hex letters').not.toBe(current.entityId)
        await updateDocument(request, token, kind, documentId, { customerEntityId: upperCaseCustomerId })
        const resavedUpperCase = await readDocument(request, token, kind, documentId)
        expect(resavedUpperCase).toMatchObject({
          customerEntityId: current.entityId,
          customerContactId: current.personId,
          billingAddressId,
          shippingAddressId,
        })
        expect(resavedUpperCase.billingAddressSnapshot ?? null).toEqual(before.billingAddressSnapshot ?? null)
        expect(resavedUpperCase.shippingAddressSnapshot ?? null).toEqual(before.shippingAddressSnapshot ?? null)
        expect(snapshotContactId(resavedUpperCase)).toBe(current.personId)

        await updateDocument(request, token, kind, documentId, { customerEntityId: other.entityId })
        const changed = await readDocument(request, token, kind, documentId)
        expect(changed).toMatchObject({
          customerEntityId: other.entityId,
          customerContactId: null,
          billingAddressId: null,
          shippingAddressId: null,
        })
        expect(changed.billingAddressSnapshot ?? null).toBeNull()
        expect(changed.shippingAddressSnapshot ?? null).toBeNull()
        expect(snapshotContactId(changed)).toBeNull()
      } finally {
        await deleteSalesEntityIfExists(request, token, `/api/sales/${kind}`, documentId)
        for (const addressId of addressIds) {
          await deleteEntityIfExists(request, token, '/api/customers/addresses', addressId)
        }
        for (const customerId of customerIds) {
          await deleteEntityIfExists(request, token, '/api/customers/people', customerId)
        }
      }
    })
  }
})
