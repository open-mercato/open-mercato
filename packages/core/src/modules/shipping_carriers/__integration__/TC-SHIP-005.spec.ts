import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createShipment, sendWebhook } from './helpers/fixtures'

/**
 * TC-SHIP-005: Webhook processing
 *
 * Creates a shipment, then sends a mock webhook to the carrier webhook
 * endpoint. Verifies the webhook is accepted (202) and queued for
 * asynchronous processing.
 *
 * The webhook endpoint at POST /api/shipping-carriers/webhook/[provider]
 * does not require authentication (it is called by the carrier).
 */
test.describe('TC-SHIP-005: Webhook processing', () => {
  test('should accept a valid webhook payload and return 202', async ({ request }) => {
    const token = await getAuthToken(request)

    const shipment = await createShipment(request, token, {
      providerKey: 'mock_carrier',
    })

    const response = await sendWebhook(request, 'mock_carrier', {
      shipmentId: shipment.carrierShipmentId,
      eventType: 'shipment.in_transit',
      data: {
        trackingNumber: shipment.trackingNumber,
        status: 'in_transit',
      },
    })

    expect(response.status()).toBe(202)
    const body = await response.json()
    expect(body.received).toBe(true)
    expect(body.queued).toBe(true)
  })

  test('should return 404 for unknown provider webhook', async ({ request }) => {
    const response = await sendWebhook(request, 'nonexistent_carrier', {
      shipmentId: 'fake-id',
      eventType: 'shipment.delivered',
      data: {},
    })

    expect(response.status()).toBe(404)
  })
})
