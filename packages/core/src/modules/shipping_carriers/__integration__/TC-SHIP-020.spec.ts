import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createOrganizationFixture, deleteOrganizationIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  deleteCarrierShipmentInDb,
  deleteCarrierWebhookClaimsInDb,
  getCarrierShipmentRowFromDb,
  hasCarrierWebhookClaimInDb,
  insertCarrierShipmentInDb,
} from './helpers/db'
import { sendWebhook } from './helpers/fixtures'

test.describe('TC-SHIP-020: Ambiguous signed webhook shipments', () => {
  test('rejects two organizations sharing a carrier shipment id and signing secret', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const { tenantId } = getTokenContext(token)
    if (!tenantId) throw new Error('[internal] Test token has no tenant context')
    const organizationIds: string[] = []
    const shipmentIds = [randomUUID(), randomUUID()]
    const carrierShipmentId = `tc-ship-020-${randomUUID()}`
    const rejectedEventId = randomUUID()
    const acceptedEventId = randomUUID()

    try {
      for (const shipmentId of shipmentIds) {
        const organizationId = await createOrganizationFixture(request, token, {
          name: `TC-SHIP-020 ${shipmentId}`, tenantId,
        })
        organizationIds.push(organizationId)
        await insertCarrierShipmentInDb({
          id: shipmentId, orderId: randomUUID(), providerKey: 'mock_carrier',
          carrierShipmentId, organizationId, tenantId,
        })
      }

      const response = await sendWebhook(request, 'mock_carrier', {
        id: rejectedEventId, shipmentId: carrierShipmentId,
        type: 'shipment.delivered', data: { status: 'delivered' },
      })

      expect(response.status()).toBe(401)
      expect(await readJsonSafe(response)).toEqual({ error: 'Webhook verification failed' })
      for (const shipmentId of shipmentIds) {
        expect((await getCarrierShipmentRowFromDb(shipmentId))?.unifiedStatus).toBe('label_created')
      }
      expect(await hasCarrierWebhookClaimInDb(rejectedEventId, 'mock_carrier')).toBe(false)

      await deleteCarrierShipmentInDb(shipmentIds[1])
      const uniqueResponse = await sendWebhook(request, 'mock_carrier', {
        id: acceptedEventId, shipmentId: carrierShipmentId,
        type: 'shipment.delivered', data: { status: 'delivered' },
      })
      expect(uniqueResponse.status()).toBe(202)
      expect(await readJsonSafe(uniqueResponse)).toEqual({ received: true, queued: true })
      await expect.poll(() => hasCarrierWebhookClaimInDb(acceptedEventId, 'mock_carrier')).toBe(true)
      await expect.poll(async () => (await getCarrierShipmentRowFromDb(shipmentIds[0]))?.unifiedStatus).toBe('delivered')
    } finally {
      await deleteCarrierWebhookClaimsInDb([rejectedEventId, acceptedEventId])
      for (const shipmentId of shipmentIds) await deleteCarrierShipmentInDb(shipmentId)
      for (const organizationId of organizationIds) await deleteOrganizationIfExists(request, token, organizationId)
    }
  })
})
