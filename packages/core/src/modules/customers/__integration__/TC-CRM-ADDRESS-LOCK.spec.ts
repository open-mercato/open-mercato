import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

test.describe('customer address optimistic locking', () => {
  test('refuses stale update and delete while accepting the latest child version', async ({ request }) => {
    const token = await getAuthToken(request)
    let ownerId: string | null = null
    let addressId: string | null = null
    const addressesPath = '/api/customers/addresses'
    const readAddress = async () => {
      const response = await apiRequest(request, 'GET', `${addressesPath}?entityId=${ownerId}&pageSize=100`, { token })
      expect(response.status()).toBe(200)
      const body = await readJsonSafe<{ items?: Array<{ id: string; updated_at: string; city: string | null; region: string | null }> }>(response)
      const address = body?.items?.find((entry) => entry.id === addressId)
      expect(address?.updated_at).toBeTruthy()
      if (!address) throw new Error('[internal] address fixture missing')
      return address
    }
    try {
      const ownerResponse = await apiRequest(request, 'POST', '/api/customers/companies', {
        token, data: { displayName: `QA address lock ${Date.now()}` },
      })
      expect(ownerResponse.status()).toBe(201)
      ownerId = (await readJsonSafe<{ id: string }>(ownerResponse))?.id ?? null
      expect(ownerId).toBeTruthy()
      const created = await apiRequest(request, 'POST', addressesPath, {
        token, data: { entityId: ownerId, addressLine1: '1 QA Street', city: 'Original city', region: 'Original region' },
      })
      expect(created.status()).toBe(201)
      addressId = (await readJsonSafe<{ id: string }>(created))?.id ?? null
      expect(addressId).toBeTruthy()
      const original = await readAddress()
      const headers = { [OPTIMISTIC_LOCK_HEADER_NAME]: original.updated_at }
      const current = await apiRequest(request, 'PUT', addressesPath, {
        token, headers, data: { id: addressId, region: 'New region' },
      })
      expect(current.status()).toBe(200)
      const staleUpdate = await apiRequest(request, 'PUT', addressesPath, {
        token, headers, data: { id: addressId, city: 'Stale city', region: original.region },
      })
      expect(staleUpdate.status()).toBe(409)
      expect((await readJsonSafe<{ code: string }>(staleUpdate))?.code).toBe('optimistic_lock_conflict')
      const staleDelete = await apiRequest(request, 'DELETE', addressesPath, { token, headers, data: { id: addressId } })
      expect(staleDelete.status()).toBe(409)
      const preserved = await readAddress()
      expect(preserved.city).toBe('Original city')
      expect(preserved.region).toBe('New region')
      const freshDelete = await apiRequest(request, 'DELETE', addressesPath, {
        token, headers: { ...headers, [OPTIMISTIC_LOCK_HEADER_NAME]: preserved.updated_at }, data: { id: addressId },
      })
      expect(freshDelete.status()).toBe(200)
      addressId = null
    } finally {
      if (addressId) await apiRequest(request, 'DELETE', addressesPath, { token, data: { id: addressId } })
      if (ownerId) await apiRequest(request, 'DELETE', '/api/customers/companies', { token, data: { id: ownerId } })
    }
  })
})
