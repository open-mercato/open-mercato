import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  cancelThenDeleteClaimIfPossible,
  cleanupDraftClaimWithLines,
  createClaimFixture,
  expectClaimStatus,
  listClaimLines,
  readClaim,
  resolveLineThroughLifecycle,
  submitAndExpect,
  submitClaim,
  transitionAndExpect,
  transitionClaim,
  uniqueLabel,
  updateClaim,
} from './helpers'

test.describe('TC-WC-003: warranty claim lifecycle commands', () => {
  test('covers lifecycle happy path, invalid transitions, rejection reason, credit-only skip, and stale locks', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-003')

    let happyClaimId: string | null = null
    let illegalClaimId: string | null = null
    let rejectionClaimId: string | null = null
    let creditOnlyClaimId: string | null = null
    let staleClaimId: string | null = null

    try {
      let happy = await createClaimFixture(request, token, {
        claimType: 'warranty',
        customerName: `QA WC Happy ${stamp}`,
        reasonCode: 'defective',
        currencyCode: 'USD',
        lines: [
          {
            lineNo: 1,
            sku: `WC-003-HAPPY-${stamp}`,
            productName: 'QA lifecycle part',
            serialNumber: `SER-HAPPY-${stamp}`,
            faultDescription: 'Lifecycle happy path',
            qtyClaimed: 1,
            creditAmount: 40,
          },
        ],
      })
      happyClaimId = happy.id
      const [happyLine] = await listClaimLines(request, token, happyClaimId!)

      happy = await submitAndExpect(request, token, happy)
      happy = await transitionAndExpect(request, token, happy, 'in_review')
      happy = await transitionAndExpect(request, token, happy, 'approved')
      happy = await transitionAndExpect(request, token, happy, 'awaiting_return')
      happy = await transitionAndExpect(request, token, happy, 'received')
      happy = await transitionAndExpect(request, token, happy, 'inspecting')
      await resolveLineThroughLifecycle(request, token, happyClaimId!, happyLine.id!, {
        qtyApproved: 1,
        qtyReceived: 1,
        creditAmount: 40,
      })
      happy = await transitionAndExpect(request, token, happy, 'resolved', {
        resolutionSummary: `Resolved happy path ${stamp}`,
      })
      happy = await transitionAndExpect(request, token, happy, 'closed')
      expect(happy.status).toBe('closed')

      let illegal = await createClaimFixture(request, token, {
        claimType: 'warranty',
        customerName: `QA WC Illegal ${stamp}`,
        reasonCode: 'defective',
        currencyCode: 'USD',
      })
      illegalClaimId = illegal.id
      illegal = await submitAndExpect(request, token, illegal)
      const illegalTransition = await transitionClaim(
        request,
        token,
        { id: illegalClaimId!, toStatus: 'approved' },
        illegal.updatedAt,
      )
      expect(illegalTransition.status(), 'submitted -> approved should be illegal').toBe(400)
      await cancelThenDeleteClaimIfPossible(request, token, illegalClaimId)
      illegalClaimId = null

      let rejection = await createClaimFixture(request, token, {
        claimType: 'warranty',
        customerName: `QA WC Rejection ${stamp}`,
        reasonCode: 'defective',
        currencyCode: 'USD',
      })
      rejectionClaimId = rejection.id
      rejection = await submitAndExpect(request, token, rejection)
      rejection = await transitionAndExpect(request, token, rejection, 'in_review')
      const rejectWithoutReason = await transitionClaim(
        request,
        token,
        { id: rejectionClaimId!, toStatus: 'rejected' },
        rejection.updatedAt,
      )
      expect(rejectWithoutReason.status(), 'rejected transition requires a rejectionReasonCode').toBe(400)
      rejection = await transitionAndExpect(request, token, rejection, 'rejected', {
        rejectionReasonCode: 'not-covered',
      })
      expect(rejection.rejectionReasonCode).toBe('not-covered')
      rejection = await transitionAndExpect(request, token, rejection, 'in_review')
      await cancelThenDeleteClaimIfPossible(request, token, rejectionClaimId)
      rejectionClaimId = null

      let creditOnly = await createClaimFixture(request, token, {
        claimType: 'warranty',
        customerName: `QA WC Credit Only ${stamp}`,
        reasonCode: 'defective',
        currencyCode: 'USD',
        lines: [
          {
            lineNo: 1,
            sku: `WC-003-CREDIT-${stamp}`,
            productName: 'QA credit-only part',
            serialNumber: `SER-CREDIT-${stamp}`,
            faultDescription: 'Credit-only skip to resolved',
            qtyClaimed: 1,
            creditAmount: 20,
          },
        ],
      })
      creditOnlyClaimId = creditOnly.id
      const [creditOnlyLine] = await listClaimLines(request, token, creditOnlyClaimId!)
      creditOnly = await submitAndExpect(request, token, creditOnly)
      creditOnly = await transitionAndExpect(request, token, creditOnly, 'in_review')
      creditOnly = await transitionAndExpect(request, token, creditOnly, 'approved')
      await resolveLineThroughLifecycle(request, token, creditOnlyClaimId!, creditOnlyLine.id!, {
        qtyApproved: 1,
        qtyReceived: 1,
        creditAmount: 20,
      })
      creditOnly = await readClaim(request, token, creditOnlyClaimId!)
      creditOnly = await transitionAndExpect(request, token, creditOnly, 'resolved', {
        resolutionSummary: `Credit-only resolved ${stamp}`,
      })
      expect(creditOnly.status).toBe('resolved')

      let stale = await createClaimFixture(request, token, {
        claimType: 'return',
        customerName: `QA WC Stale ${stamp}`,
        reasonCode: 'defective',
        notes: `Initial stale-lock notes ${stamp}`,
        currencyCode: 'USD',
      })
      staleClaimId = stale.id
      const originalUpdatedAt = stale.updatedAt
      await new Promise((resolve) => setTimeout(resolve, 5))
      const freshUpdate = await updateClaim(
        request,
        token,
        { id: staleClaimId, notes: `Fresh edit before stale submit ${stamp}` },
        originalUpdatedAt,
      )
      expect(freshUpdate.status(), 'fresh claim edit should succeed').toBe(200)
      stale = await expectClaimStatus(request, token, staleClaimId!, 'draft')
      expect(stale.updatedAt).not.toBe(originalUpdatedAt)

      const staleSubmit = await submitClaim(request, token, staleClaimId!, originalUpdatedAt)
      expect(staleSubmit.status(), 'stale submit should return 409').toBe(409)
      const staleBody = await readJsonSafe<Record<string, unknown>>(staleSubmit)
      expect(staleBody).toMatchObject({
        code: 'optimistic_lock_conflict',
        expectedUpdatedAt: originalUpdatedAt,
      })
    } finally {
      await cancelThenDeleteClaimIfPossible(request, token, staleClaimId)
      await cancelThenDeleteClaimIfPossible(request, token, rejectionClaimId)
      await cancelThenDeleteClaimIfPossible(request, token, illegalClaimId)
      await cleanupDraftClaimWithLines(request, token, creditOnlyClaimId)
      await cleanupDraftClaimWithLines(request, token, happyClaimId)
    }
  })
})
