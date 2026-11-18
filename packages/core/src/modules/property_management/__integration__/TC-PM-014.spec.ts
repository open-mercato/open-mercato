import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { stampOf } from './helpers'
import {
  cleanupLeaseSetup,
  createLease,
  createLeaseSetup,
  drainSalesOperations,
  isoDayFromToday,
  MONTHLY_RATE,
  postLease,
  proposalSent,
  readDocumentLines,
  readField,
  readLease,
  readSalesDocument,
  requireLease,
  waitForLease,
  type LeaseSetup,
} from './leaseFixtures'

/**
 * TC-PM-014: lease proposal
 * A proposal answers 202 sending and becomes sent once its recurring quote exists (line = the unit's
 * product at the monthly rate, validUntil = respond-by). The proposal reserves the unit: another
 * company cannot lease it for an overlapping term. Withdrawing frees the unit and cancels the quote.
 * A proposed lease must start on or after its respond-by date.
 */
test.describe('TC-PM-014: lease proposal', () => {
  test('sends a recurring quote, reserves the unit and frees it on withdrawal', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: LeaseSetup | null = null
    try {
      setup = await createLeaseSetup(request, token, stamp, { units: 1, companies: 2 })
      const [unitId] = setup.unitIds
      const [companyA, companyB] = setup.companyIds

      const tooEarly = await postLease(request, token, {
        unitId,
        customerCompanyId: companyA,
        startsOn: isoDayFromToday(2),
        termMonths: 12,
        asProposal: true,
        expiresInDays: 14,
      })
      const tooEarlyBody = await readJsonSafe<{ code?: string }>(tooEarly)
      expect(tooEarly.status()).toBe(422)
      expect(tooEarlyBody?.code).toBe('proposal_starts_before_respond_by')

      const startsOn = isoDayFromToday(30)
      const proposed = await createLease(request, token, setup, {
        unitId,
        customerCompanyId: companyA,
        startsOn,
        termMonths: 12,
        asProposal: true,
        expiresInDays: 14,
      })
      expect(proposed.status).toBe('sending')
      expect(proposed.proposalId).toBeTruthy()

      const blocked = await postLease(request, token, { unitId, customerCompanyId: companyB, startsOn: isoDayFromToday(60), termMonths: 3 })
      const blockedBody = await readJsonSafe<{ code?: string }>(blocked)
      expect(blocked.status(), 'an open proposal reserves the unit').toBe(409)
      expect(blockedBody?.code).toBe('lease_overlap')

      const proposedList = await readJsonSafe<{ items?: Array<{ id: string; status: string }> }>(
        await apiRequest(request, 'GET', `/api/property_management/leases?status=proposed&unitId=${unitId}`, { token }),
      )
      expect((proposedList?.items ?? []).map((item) => item.id)).toContain(proposed.id)

      const sending = await waitForLease(request, token, proposed.id, proposalSent(proposed.proposalId as string))
      const sent = sending.value
      if (sent) {
        const proposal = sent.proposals.find((entry) => entry.id === proposed.proposalId)
        expect(proposal?.status).toBe('sent')
        const quoteId = proposal?.salesQuoteId as string
        expect(quoteId, 'the sent proposal links its quote').toBeTruthy()
        const quote = await readSalesDocument(request, token, 'quotes', quoteId)
        expect(readField(quote, 'recurrence')).toMatchObject({ frequency: 'monthly', startsOn, periodCount: 12 })
        const lines = await readDocumentLines(request, token, 'quote', quoteId)
        expect(lines).toHaveLength(1)
        expect(readField(lines[0], 'productId', 'product_id')).toBe(setup.products?.productId)
        expect(Number(readField(lines[0], 'unitPriceNet', 'unit_price_net'))).toBe(MONTHLY_RATE)
      }

      const withdraw = await apiRequest(request, 'DELETE', `/api/property_management/leases/${proposed.id}/proposals/${proposed.proposalId}`, { token })
      expect(withdraw.status()).toBe(200)
      const withdrawn = await readLease(request, token, proposed.id)
      expect(withdrawn?.lease.status).toBe('withdrawn')
      expect(withdrawn?.proposals.find((entry) => entry.id === proposed.proposalId)?.status).toBe('withdrawn')

      const again = await apiRequest(request, 'DELETE', `/api/property_management/leases/${proposed.id}/proposals/${proposed.proposalId}`, { token })
      expect(again.status(), 'a withdrawn proposal is no longer open').toBe(409)

      const freed = await createLease(request, token, setup, { unitId, customerCompanyId: companyB, startsOn: isoDayFromToday(60), termMonths: 3 })
      expect(freed.status, 'the unit is free again').toBe('pending_order')

      const sentDetail = await requireLease(token, proposed.id, sending, 'the proposal quote')
      const quoteId = sentDetail.proposals.find((entry) => entry.id === proposed.proposalId)?.salesQuoteId as string
      await drainSalesOperations()
      await expect
        .poll(async () => readField(await readSalesDocument(request, token, 'quotes', quoteId), 'status'), { timeout: 15_000 })
        .toBe('canceled')
    } finally {
      await cleanupLeaseSetup(request, token, setup)
    }
  })
})
