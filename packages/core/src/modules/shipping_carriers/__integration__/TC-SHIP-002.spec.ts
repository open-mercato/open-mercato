import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

test.describe('TC-SHIP-002: create, track, cancel shipment', () => {
  test('should create shipment, read tracking and cancel', async ({ request }) => {
    const token = await getAuthToken(request)
    const create = await apiRequest(request, 'POST', '/api/shipping-carriers/shipments', {
      token,
      data: {
        providerKey: 'inpost',
        orderId: crypto.randomUUID(),
        origin: { countryCode: 'PL', postalCode: '00-001', city: 'Warsaw', line1: 'Street 1' },
        destination: { countryCode: 'PL', postalCode: '30-001', city: 'Krakow', line1: 'Street 2' },
        packages: [{ weightKg: 1.2, lengthCm: 20, widthCm: 12, heightCm: 8 }],
        serviceCode: 'locker_standard',
        labelFormat: 'pdf',
      },
    })
    expect(create.status()).toBe(201)
    const created = await create.json()
    expect(created.shipmentId).toBeTruthy()
    expect(created.trackingNumber).toBeTruthy()

    const tracking = await apiRequest(
      request,
      'GET',
      `/api/shipping-carriers/tracking?providerKey=inpost&shipmentId=${encodeURIComponent(created.shipmentId)}`,
      { token },
    )
    expect(tracking.status()).toBe(200)
    const trackingBody = await tracking.json()
    expect(trackingBody.status).toBeTruthy()

    const cancel = await apiRequest(request, 'POST', '/api/shipping-carriers/cancel', {
      token,
      data: {
        providerKey: 'inpost',
        shipmentId: created.shipmentId,
        reason: 'customer_request',
      },
    })
    expect(cancel.status()).toBe(200)
    const cancelBody = await cancel.json()
    expect(cancelBody.status).toBe('cancelled')
  })
})
