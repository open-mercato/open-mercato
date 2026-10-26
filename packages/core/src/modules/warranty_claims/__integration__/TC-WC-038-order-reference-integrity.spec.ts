import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createOrderLineFixture, deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import {
  cleanupDraftClaimWithLines,
  createClaimFixture,
  listClaimLines,
  readClaim,
  readClaimEvents,
  uniqueLabel,
  updateClaim,
  updateClaimLine,
} from './helpers'

test.describe('TC-WC-038: claim order reference integrity', () => {
  test('rejects incompatible order changes atomically and allows matching linkage and explicit line detachment', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-038')
    let customerId: string | null = null
    const orderIds: string[] = []
    const claimIds: string[] = []

    try {
      customerId = await createCompanyFixture(request, token, `WC-038 customer ${stamp}`)
      for (const suffix of ['A', 'B']) {
        const response = await apiRequest(request, 'POST', '/api/sales/orders', {
          token,
          data: {
            customerEntityId: customerId,
            currencyCode: 'USD',
            lines: [{ currencyCode: 'USD', name: `WC-038 order ${suffix} ${stamp}`, quantity: 1, unitPriceNet: 10, unitPriceGross: 10 }],
          },
        })
        const body = await readJsonSafe<{ id?: string; orderId?: string }>(response)
        expect(response.ok(), `order creation failed: ${JSON.stringify(body)}`).toBeTruthy()
        orderIds.push(expectId(body?.id ?? body?.orderId, 'sales order id'))
      }
      const [orderAId, orderBId] = orderIds
      const orderLineId = await createOrderLineFixture(request, token, orderAId, { quantity: 2 })
      const claim = await createClaimFixture(request, token, {
        claimType: 'return', customerId, orderId: orderAId, currencyCode: 'USD',
        lines: [{ orderLineId, qtyClaimed: 1 }],
      })
      const claimId = expectId(claim.id, 'claim id')
      claimIds.push(claimId)
      const initialLines = await listClaimLines(request, token, claimId)
      const initialEvents = await readClaimEvents(request, token, claimId)

      for (const orderId of [orderBId, null]) {
        const response = await updateClaim(request, token, {
          id: claimId, orderId, notes: 'Must not persist',
        }, claim.updatedAt)
        expect(response.status()).toBe(400)
        expect(await readClaim(request, token, claimId)).toEqual(claim)
        expect(await listClaimLines(request, token, claimId)).toEqual(initialLines)
        expect(await readClaimEvents(request, token, claimId)).toEqual(initialEvents)
      }

      const unlinked = await createClaimFixture(request, token, {
        claimType: 'return', customerId, currencyCode: 'USD',
        lines: [{ orderLineId, qtyClaimed: 1 }],
      })
      const unlinkedId = expectId(unlinked.id, 'unlinked claim id')
      claimIds.push(unlinkedId)
      const wrongLink = await updateClaim(request, token, { id: unlinkedId, orderId: orderBId }, unlinked.updatedAt)
      expect(wrongLink.status()).toBe(400)
      expect(await readClaim(request, token, unlinkedId)).toEqual(unlinked)
      const matchingLink = await updateClaim(request, token, { id: unlinkedId, orderId: orderAId }, unlinked.updatedAt)
      expect(matchingLink.status()).toBe(200)
      expect((await readClaim(request, token, unlinkedId)).orderId).toBe(orderAId)

      const line = initialLines[0]
      const unchangedLine = await updateClaimLine(request, token, {
        id: line.id, orderLineId, faultDescription: 'Updated fault',
      }, line.updatedAt)
      expect(unchangedLine.status()).toBe(200)
      const updatedLine = (await listClaimLines(request, token, claimId))[0]
      const detachLine = await updateClaimLine(request, token, { id: line.id, orderLineId: null }, updatedLine.updatedAt)
      expect(detachLine.status()).toBe(200)
      const detachedClaim = await readClaim(request, token, claimId)
      const reassign = await updateClaim(request, token, { id: claimId, orderId: orderBId }, detachedClaim.updatedAt)
      expect(reassign.status()).toBe(200)
      const reassigned = await readClaim(request, token, claimId)
      expect(reassigned.orderId).toBe(orderBId)
      const clear = await updateClaim(request, token, { id: claimId, orderId: null }, reassigned.updatedAt)
      expect(clear.status()).toBe(200)
      expect((await readClaim(request, token, claimId)).orderId).toBeNull()
    } finally {
      for (const claimId of claimIds.reverse()) await cleanupDraftClaimWithLines(request, token, claimId)
      for (const orderId of orderIds.reverse()) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', customerId)
    }
  })
})
