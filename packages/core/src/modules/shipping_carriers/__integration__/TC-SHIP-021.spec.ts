import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createOrganizationFixture, deleteOrganizationIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteCarrierShipmentInDb, getCarrierShipmentRowFromDb, insertCarrierShipmentInDb } from './helpers/db'

const routes = ['/api/shipping-carriers/cancel', '/api/shipping-carriers/tracking/refresh']
const localizedErrors: Array<{ headers: Record<string, string>; error: string }> = [
  { headers: {}, error: 'Shipment not found' },
  { headers: { 'Accept-Language': 'pl' }, error: 'Nie znaleziono przesyłki' },
]

test.describe('TC-SHIP-021: Cancel, tracking refresh and tracking return 404 for shipments outside the caller scope', () => {
  test('returns 404 for an unknown shipment id and for another organization shipment, leaving it untouched', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const { tenantId, organizationId: callerOrganizationId } = getTokenContext(token)
    if (!tenantId) throw new Error('[internal] Test token has no tenant context')
    const foreignShipmentId = randomUUID()
    let foreignOrganizationId: string | null = null

    try {
      foreignOrganizationId = await createOrganizationFixture(request, token, {
        name: `TC-SHIP-021 ${foreignShipmentId}`, tenantId,
      })
      expect(foreignOrganizationId).not.toBe(callerOrganizationId)
      await insertCarrierShipmentInDb({
        id: foreignShipmentId, orderId: randomUUID(), providerKey: 'mock_carrier',
        carrierShipmentId: `tc-ship-021-${foreignShipmentId}`, organizationId: foreignOrganizationId, tenantId,
      })

      for (const path of routes) {
        for (const shipmentId of [randomUUID(), foreignShipmentId]) {
          for (const { headers, error } of localizedErrors) {
            const response = await apiRequest(request, 'POST', path, {
              token,
              headers,
              data: { providerKey: 'mock_carrier', shipmentId },
            })
            expect(response.status(), `${path} must return 404 for ${shipmentId}`).toBe(404)
            expect(await readJsonSafe(response)).toEqual({ error })
          }
        }
      }

      for (const shipmentId of [randomUUID(), foreignShipmentId]) {
        const response = await apiRequest(
          request,
          'GET',
          `/api/shipping-carriers/tracking?providerKey=mock_carrier&shipmentId=${shipmentId}`,
          { token },
        )
        expect(response.status(), `GET tracking must return 404 for ${shipmentId}`).toBe(404)
        expect(await readJsonSafe(response)).toEqual({ error: 'Shipment not found' })
      }

      const row = await getCarrierShipmentRowFromDb(foreignShipmentId)
      expect(row?.unifiedStatus).toBe('label_created')
      expect(row?.lastPolledAt).toBeNull()
      expect(row?.organizationId).toBe(foreignOrganizationId)
    } finally {
      await deleteCarrierShipmentInDb(foreignShipmentId)
      await deleteOrganizationIfExists(request, token, foreignOrganizationId)
    }
  })
})
