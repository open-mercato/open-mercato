import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  expectOperation,
  redoOk,
  skipIfUndoTestsDisabled,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'

const ADDRESSES_PATH = '/api/customers/addresses'

async function listFreshAddresses(request: APIRequestContext, token: string, entityId: string) {
  const response = await apiRequest(request, 'GET', `${ADDRESSES_PATH}?entityId=${encodeURIComponent(entityId)}&_testRead=${randomUUID()}`, {
    token,
  })
  expect(response.status(), 'address list should succeed').toBe(200)
  expect(response.headers()['x-om-cache'], 'address verification should use a fresh response').not.toBe('hit')
  const body = await readJsonSafe<{ items?: Record<string, unknown>[] }>(response)
  expect(Array.isArray(body?.items), 'address list should contain items').toBe(true)
  return body?.items ?? []
}

test.describe('TC-UNDO-001 customer deletion preserves address fields (#7854)', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  for (const kind of ['people', 'companies'] as const) {
    test(`${kind} delete, undo, redo, and second undo retain the complete address`, async ({ request }) => {
      const token = await getAuthToken(request, 'admin')
      const scope = getTokenContext(token)
      const parentPath = `/api/customers/${kind}`
      let parentId: string | null = null
      let addressId: string | null = null

      try {
        const displayName = `Address Undo ${kind} ${Date.now()}`
        parentId = kind === 'people'
          ? await createPersonFixture(request, token, { firstName: 'Address', lastName: 'Undo', displayName })
          : await createCompanyFixture(request, token, displayName)

        const addressResponse = await apiRequest(request, 'POST', ADDRESSES_PATH, {
          token,
          data: {
            entityId: parentId,
            name: 'Warehouse',
            purpose: 'shipping',
            companyName: 'Delivery Ltd',
            addressLine1: 'Delivery Street',
            addressLine2: 'North entrance',
            buildingNumber: '42',
            flatNumber: '7',
            city: 'Warsaw',
            region: 'Mazowieckie',
            postalCode: '00-001',
            country: 'PL',
            latitude: 52.1875,
            longitude: 21.0625,
            isPrimary: true,
          },
        })
        expect(addressResponse.status(), 'address creation should succeed').toBe(201)
        const addressBody = await readJsonSafe<{ id?: string }>(addressResponse)
        addressId = expectId(addressBody?.id, 'address creation should return its id')

        const expectedAddress = {
          id: addressId,
          entity_id: parentId,
          organization_id: scope.organizationId,
          tenant_id: scope.tenantId,
          name: 'Warehouse',
          purpose: 'shipping',
          company_name: 'Delivery Ltd',
          address_line1: 'Delivery Street',
          address_line2: 'North entrance',
          building_number: '42',
          flat_number: '7',
          city: 'Warsaw',
          region: 'Mazowieckie',
          postal_code: '00-001',
          country: 'PL',
          latitude: 52.1875,
          longitude: 21.0625,
          is_primary: true,
        }
        expect(await listFreshAddresses(request, token, parentId)).toEqual([expect.objectContaining(expectedAddress)])

        const deleteResponse = await apiRequest(request, 'DELETE', `${parentPath}?id=${encodeURIComponent(parentId)}`, {
          token,
        })
        expect(deleteResponse.ok(), 'customer deletion should succeed').toBe(true)
        const deleted = expectOperation(deleteResponse, `${kind} delete`)
        expect(await listFreshAddresses(request, token, parentId)).toEqual([])

        await undoOk(request, token, deleted.undoToken, `${kind} delete`)
        expect(await listFreshAddresses(request, token, parentId)).toEqual([expect.objectContaining(expectedAddress)])

        const redone = await redoOk(request, token, deleted.logId, `${kind} delete`)
        expect(await listFreshAddresses(request, token, parentId)).toEqual([])

        const secondUndoToken = expectId(redone.undoToken, 'redo should issue an undo token')
        await undoOk(request, token, secondUndoToken, `${kind} delete redo`)
        expect(await listFreshAddresses(request, token, parentId)).toEqual([expect.objectContaining(expectedAddress)])
      } finally {
        await deleteEntityIfExists(request, token, ADDRESSES_PATH, addressId)
        await deleteEntityIfExists(request, token, parentPath, parentId)
      }
    })
  }
})
