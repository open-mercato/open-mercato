import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { createShipment, sendWebhook } from '@open-mercato/core/modules/shipping_carriers/__integration__/helpers/fixtures'
import {
  deleteCarrierShipmentInDb,
  deleteCarrierWebhookClaimsInDb,
} from '@open-mercato/core/modules/shipping_carriers/__integration__/helpers/db'
import {
  cancelThenDeleteClaimIfPossible,
  createClaimFixture,
  readClaim,
  submitAndExpect,
  transitionAndExpect,
  uniqueLabel,
} from './helpers'

export const integrationMeta = {
  dependsOnModules: ['shipping_carriers'],
}

/**
 * TC-WC-035: a delivered carrier webhook for the return shipment receives the claim.
 *
 * `warranty_claims:return-shipment-tracking` moves an `awaiting_return` claim to
 * `received` when `shipping_carriers.shipment.delivered` fires for the shipment
 * whose tracking number is the claim's return tracking number. The carrier here
 * reports `delivered` directly after the label was created (no pickup or transit
 * scans), which is how a parcel looks when intermediate scans never arrive.
 */
test.describe('TC-WC-035: return shipment delivery receives the warranty claim', () => {
  test('moves an awaiting_return claim to received when the carrier reports the return delivered', async ({ request }) => {
    test.setTimeout(60_000)
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-035')
    let claimId: string | null = null
    let shipmentId: string | null = null
    const eventIds: string[] = []

    try {
      const shipment = await createShipment(request, adminToken, { providerKey: 'mock_carrier' })
      shipmentId = shipment.shipmentId
      expect(shipment.status).toBe('label_created')

      let claim = await createClaimFixture(request, adminToken, {
        claimType: 'return',
        customerName: `QA WC Return Delivered ${stamp}`,
        reasonCode: 'damaged',
        currencyCode: 'USD',
      })
      claimId = claim.id
      claim = await submitAndExpect(request, adminToken, claim)
      claim = await transitionAndExpect(request, adminToken, claim, 'in_review')
      claim = await transitionAndExpect(request, adminToken, claim, 'approved')

      const labelResponse = await apiRequest(request, 'POST', '/api/warranty_claims/return-label', {
        token: adminToken,
        data: {
          claimId: claim.id,
          manual: true,
          labelUrl: `https://labels.test.invalid/${stamp}.pdf`,
          trackingNumber: shipment.trackingNumber,
          carrier: 'mock_carrier',
          updatedAt: claim.updatedAt,
        },
      })
      const labelBody = await readJsonSafe<{ status?: string }>(labelResponse)
      expect(labelResponse.status(), `manual return label should return 200: ${JSON.stringify(labelBody)}`).toBe(200)

      claim = await readClaim(request, adminToken, claim.id!)
      if (claim.status !== 'awaiting_return') {
        claim = await transitionAndExpect(request, adminToken, claim, 'awaiting_return')
      }

      const eventId = `tc-wc-035-${stamp}`
      eventIds.push(eventId)
      const webhook = await sendWebhook(request, 'mock_carrier', {
        id: eventId,
        type: 'shipment.delivered',
        shipmentId: shipment.carrierShipmentId,
        data: { status: 'delivered' },
      })
      expect(webhook.status(), 'delivered webhook should be accepted').toBe(202)

      await expect
        .poll(async () => (await readClaim(request, adminToken, claim.id!)).status, {
          message: 'the delivered return shipment should receive the claim',
          timeout: 30_000,
        })
        .toBe('received')
    } finally {
      await cancelThenDeleteClaimIfPossible(request, adminToken, claimId).catch(() => undefined)
      await deleteCarrierWebhookClaimsInDb(eventIds).catch(() => undefined)
      await deleteCarrierShipmentInDb(shipmentId).catch(() => undefined)
    }
  })
})
