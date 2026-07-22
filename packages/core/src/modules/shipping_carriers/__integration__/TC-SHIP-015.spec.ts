import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { defaultOrigin, defaultDestination, defaultPackage } from './helpers/fixtures'
import { getCarrierShipmentRowFromDb, deleteCarrierShipmentInDb } from './helpers/db'

/**
 * TC-SHIP-015: Shipment creation persists to the database and is retrievable.
 *
 * Existing happy-path tests assert the create response shape only. This locks in
 * persistence: the created shipment is retrievable by both `shipmentId` and
 * `trackingNumber`, and the persisted row carries the expected tracking number,
 * status, label URL, and tenant/organization scope.
 *
 * ENVIRONMENT: mixes API fixtures with DB-level assertions (raw `pg` against
 * `DATABASE_URL`). Run under a coherent app+DB stack (the `yarn test:integration`
 * / `yarn test:integration:ephemeral` harness) where the app and fixtures share
 * the same database.
 */
test.describe('TC-SHIP-015: Shipment persists and is retrievable', () => {
  test('persists a created shipment and resolves it by shipmentId and trackingNumber', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { organizationId, tenantId } = getTokenScope(token)
    expect(organizationId, 'admin token should carry an organization id').toBeTruthy()
    expect(tenantId, 'admin token should carry a tenant id').toBeTruthy()

    let shipmentId: string | null = null

    try {
      const createResponse = await apiRequest(request, 'POST', '/api/shipping-carriers/shipments', {
        token,
        data: {
          providerKey: 'mock_carrier',
          orderId: crypto.randomUUID(),
          origin: defaultOrigin(),
          destination: defaultDestination(),
          packages: [defaultPackage()],
          serviceCode: 'standard',
          labelFormat: 'pdf',
        },
      })
      expect(createResponse.status(), 'shipment creation should return 201').toBe(201)
      const created = await readJsonSafe<{
        shipmentId?: string
        trackingNumber?: string
        status?: string
        labelUrl?: string
      }>(createResponse)
      shipmentId = created?.shipmentId ?? null
      expect(shipmentId, 'create response should include a shipment id').toBeTruthy()
      expect(created?.trackingNumber, 'create response should include a tracking number').toBeTruthy()
      expect(created?.status).toBe('label_created')

      // Retrievable by shipmentId (this path reads the persisted DB row).
      const byId = await apiRequest(
        request,
        'GET',
        `/api/shipping-carriers/tracking?providerKey=mock_carrier&shipmentId=${shipmentId}`,
        { token },
      )
      expect(byId.status(), 'tracking by shipmentId should return 200').toBe(200)
      const byIdBody = await readJsonSafe<{ trackingNumber?: string }>(byId)
      expect(byIdBody?.trackingNumber, 'tracking by id should resolve the created shipment').toBe(created?.trackingNumber)

      // Also resolvable by trackingNumber (carrier lookup; the persisted-row
      // assertion below is the authoritative DB-persistence proof).
      const byTracking = await apiRequest(
        request,
        'GET',
        `/api/shipping-carriers/tracking?providerKey=mock_carrier&trackingNumber=${encodeURIComponent(created!.trackingNumber!)}`,
        { token },
      )
      expect(byTracking.status(), 'tracking by trackingNumber should return 200').toBe(200)
      const byTrackingBody = await readJsonSafe<{ trackingNumber?: string }>(byTracking)
      expect(byTrackingBody?.trackingNumber, 'tracking by number should resolve the created shipment').toBe(created?.trackingNumber)

      // Persistence detail: the row carries the expected fields and tenant scope.
      const row = await getCarrierShipmentRowFromDb(shipmentId as string)
      expect(row, 'shipment row should be persisted').not.toBeNull()
      expect(row?.trackingNumber).toBe(created?.trackingNumber)
      expect(row?.unifiedStatus).toBe('label_created')
      expect(row?.labelUrl, 'label URL should be persisted').toBe(created?.labelUrl)
      expect(row?.organizationId).toBe(organizationId)
      expect(row?.tenantId).toBe(tenantId)
    } finally {
      await deleteCarrierShipmentInDb(shipmentId).catch(() => undefined)
    }
  })
})
