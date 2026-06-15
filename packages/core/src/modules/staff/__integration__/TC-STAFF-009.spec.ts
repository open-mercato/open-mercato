import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createStaffTeamMemberFixture,
  deleteStaffEntityIfExists,
} from '@open-mercato/core/helpers/integration/staffFixtures'

/**
 * TC-STAFF-009: Team Member Addresses CRUD via API
 * Source: GitHub issue #2460 (staff coverage expansion).
 *
 * Addresses are a flat CRUD route scoped to a member via `entityId`. The
 * required line field is `addressLine1` (there is no `street` field). Responses
 * are snake_case (address_line1, postal_code).
 *
 * Verified contract:
 * - POST /api/staff/addresses { entityId, addressLine1, ... } -> 201 { id }.
 * - GET  /api/staff/addresses?entityId=<memberId> lists the address.
 * - PUT  /api/staff/addresses { id, city, postalCode } -> 200 { ok: true }.
 * - DELETE /api/staff/addresses?id=<id> -> 200 { ok: true } (hard delete; the
 *   record drops out of the list).
 */
const ADDRESSES_PATH = '/api/staff/addresses'
const MEMBERS_PATH = '/api/staff/team-members'

async function listAddresses(
  request: APIRequestContext,
  token: string,
  memberId: string,
): Promise<Array<Record<string, unknown>>> {
  const response = await apiRequest(
    request,
    'GET',
    `${ADDRESSES_PATH}?entityId=${encodeURIComponent(memberId)}`,
    { token },
  )
  expect(response.status(), 'GET /api/staff/addresses should return 200').toBe(200)
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
  return body?.items ?? []
}

test.describe('TC-STAFF-009: Team Member Addresses CRUD via API', () => {
  test('creates, lists, updates, and deletes a team member address', async ({ request }) => {
    let token: string | null = null
    let memberId: string | null = null
    let addressId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      memberId = await createStaffTeamMemberFixture(request, token, {
        displayName: `QA TC-STAFF-009 ${Date.now()}`,
      })

      const createResponse = await apiRequest(request, 'POST', ADDRESSES_PATH, {
        token,
        data: {
          entityId: memberId,
          addressLine1: '123 Market Street',
          city: 'Springfield',
          region: 'IL',
          postalCode: '62704',
          country: 'United States',
        },
      })
      expect(createResponse.status(), 'POST /api/staff/addresses should return 201').toBe(201)
      addressId = (await readJsonSafe<{ id?: string }>(createResponse))?.id ?? null
      expect(addressId, 'create should return an address id').toBeTruthy()

      const created = (await listAddresses(request, token, memberId)).find((address) => address.id === addressId)
      expect(created, 'created address should appear in the list').toBeTruthy()
      expect(created!.address_line1, 'address_line1 should persist').toBe('123 Market Street')
      expect(created!.city, 'city should persist').toBe('Springfield')
      expect(created!.postal_code, 'postal_code should persist').toBe('62704')
      expect(created!.country, 'country should persist').toBe('United States')

      const putResponse = await apiRequest(request, 'PUT', ADDRESSES_PATH, {
        token,
        data: { id: addressId, city: 'Shelbyville', postalCode: '62565' },
      })
      expect(putResponse.status(), 'PUT /api/staff/addresses should return 200').toBe(200)

      const updated = (await listAddresses(request, token, memberId)).find((address) => address.id === addressId)
      expect(updated, 'updated address should still be listed').toBeTruthy()
      expect(updated!.city, 'city should reflect the update').toBe('Shelbyville')
      expect(updated!.postal_code, 'postal_code should reflect the update').toBe('62565')
      expect(updated!.address_line1, 'untouched address_line1 should remain').toBe('123 Market Street')

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `${ADDRESSES_PATH}?id=${encodeURIComponent(addressId!)}`,
        { token },
      )
      expect(deleteResponse.status(), 'DELETE /api/staff/addresses should return 200').toBe(200)
      const deletedId = addressId
      addressId = null

      const remaining = (await listAddresses(request, token, memberId)).find((address) => address.id === deletedId)
      expect(remaining, 'deleted address should no longer be listed').toBeFalsy()
    } finally {
      await deleteStaffEntityIfExists(request, token, ADDRESSES_PATH, addressId)
      await deleteStaffEntityIfExists(request, token, MEMBERS_PATH, memberId)
    }
  })
})
