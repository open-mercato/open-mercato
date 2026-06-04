import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { createShipment } from './helpers/fixtures'

/**
 * TC-SHIP-014: Tracking query validation — at least one of `shipmentId` or
 * `trackingNumber` is required.
 *
 * The tracking query schema has a `.refine()` requiring one identifier; omitting
 * both returns 422 `{ error: 'Invalid query', details: <flattened> }` with the
 * refine message under `shipmentId`. A query carrying a valid (real) shipment id
 * returns 200 — the positive control proving the query is otherwise well-formed.
 */
test.describe('TC-SHIP-014: Tracking requires shipmentId or trackingNumber (422)', () => {
  test('returns 422 when both shipmentId and trackingNumber are omitted', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(
      request,
      'GET',
      '/api/shipping-carriers/tracking?providerKey=mock_carrier',
      { token },
    )
    expect(response.status(), 'omitting both identifiers must be 422').toBe(422)

    const body = await readJsonSafe<{
      error?: string
      details?: { fieldErrors?: Record<string, string[] | undefined> }
    }>(response)
    expect(body?.error).toBe('Invalid query')
    expect(
      (body?.details?.fieldErrors?.shipmentId ?? []).join(' '),
      'error should explain that one identifier is required',
    ).toContain('shipmentId or trackingNumber is required')
  })

  test('returns 200 for a query carrying a valid shipment id (positive control)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const shipment = await createShipment(request, token, { providerKey: 'mock_carrier' })

    const response = await apiRequest(
      request,
      'GET',
      `/api/shipping-carriers/tracking?providerKey=mock_carrier&shipmentId=${shipment.shipmentId}`,
      { token },
    )
    expect(response.status(), 'a valid shipmentId query should return 200').toBe(200)
    const body = await readJsonSafe<{ trackingNumber?: string }>(response)
    expect(body?.trackingNumber, 'tracking should resolve the created shipment').toBe(shipment.trackingNumber)
  })
})
