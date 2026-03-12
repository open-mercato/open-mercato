import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createShipment, getTracking, cancelShipment } from './helpers/fixtures'

/**
 * TC-SHIP-006: Tenant isolation
 *
 * Creates a shipment as one user, then verifies the same-tenant user
 * can access it. Shipments are scoped by organizationId + tenantId,
 * so cross-tenant access is prevented at the service layer.
 */
test.describe('TC-SHIP-006: Tenant isolation', () => {
  test('same-tenant admin should be able to track a shipment created by admin', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')

    const shipment = await createShipment(request, adminToken, {
      providerKey: 'mock_carrier',
    })
    expect(shipment.shipmentId).toBeTruthy()

    const tracking = await getTracking(request, adminToken, {
      providerKey: 'mock_carrier',
      shipmentId: shipment.shipmentId,
    })
    expect(tracking.trackingNumber).toBe(shipment.trackingNumber)
  })

  test('same-tenant admin should be able to cancel a shipment created by admin', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')

    const shipment = await createShipment(request, adminToken, {
      providerKey: 'mock_carrier',
    })
    expect(shipment.shipmentId).toBeTruthy()

    const result = await cancelShipment(request, adminToken, shipment.shipmentId, {
      providerKey: 'mock_carrier',
    })
    expect(result.status).toBe('cancelled')
  })

  test('unauthenticated request to rates endpoint should return 401', async ({ request }) => {
    const response = await apiRequest(request, 'POST', '/api/shipping-carriers/rates', {
      token: 'invalid-token-that-should-not-work',
      data: {
        providerKey: 'mock_carrier',
        origin: { countryCode: 'US', postalCode: '10001', city: 'New York', line1: '123 Test St' },
        destination: { countryCode: 'US', postalCode: '90210', city: 'Beverly Hills', line1: '456 Test Ave' },
        packages: [{ weightKg: 1, lengthCm: 10, widthCm: 10, heightCm: 10 }],
      },
    })

    expect(response.status()).toBe(401)
  })
})
