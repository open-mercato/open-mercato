import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  cancelThenDeleteClaimIfPossible,
  cleanupDraftClaimWithLines,
  createClaimFixture,
  expectClaimStatus,
  listClaimLines,
  numeric,
  resolveLineThroughLifecycle,
  submitAndExpect,
  transitionAndExpect,
  uniqueLabel,
  updateClaimLine,
} from './helpers'

test.describe('TC-WC-002: warranty claim line partial approvals', () => {
  test('validates partial quantities, recomputes header totals, and locks closed claims', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-002')

    let partialClaimId: string | null = null
    let closedClaimId: string | null = null

    try {
      const partialClaim = await createClaimFixture(request, token, {
        claimType: 'warranty',
        customerName: `QA WC Partials ${stamp}`,
        reasonCode: 'defective',
        currencyCode: 'USD',
        lines: [
          {
            lineNo: 1,
            sku: `WC-002-${stamp}`,
            productName: 'QA partial approval part',
            serialNumber: `SER-${stamp}`,
            faultDescription: 'Partial quantity acceptance',
            qtyClaimed: 5,
            creditAmount: 100,
          },
        ],
      })
      partialClaimId = partialClaim.id
      const [line] = await listClaimLines(request, token, partialClaimId!)
      expect(line?.id, 'created claim should have a line').toBeTruthy()

      const partialApprove = await updateClaimLine(
        request,
        token,
        {
          id: line.id,
          claimId: partialClaimId,
          qtyApproved: 3,
          lineStatus: 'approved',
          creditAmount: 100,
          restockingFee: 5,
          coreCreditAmount: 10,
          disposition: 'credit',
        },
        line.updatedAt,
      )
      expect(partialApprove.status(), 'qtyApproved below qtyClaimed should be accepted').toBe(200)

      const updatedLine = (await listClaimLines(request, token, partialClaimId!))[0]
      expect(numeric(updatedLine.qtyApproved), 'line should persist partial approved quantity').toBe(3)
      expect(updatedLine.lineStatus).toBe('approved')

      const rolledUp = await expectClaimStatus(request, token, partialClaimId!, 'draft')
      expect(numeric(rolledUp.totalClaimedAmount), 'claimed total should sum line credit amounts').toBe(100)
      expect(numeric(rolledUp.totalApprovedAmount), 'approved total should apply approved-line rollup policy').toBe(105)

      const invalidApprove = await updateClaimLine(
        request,
        token,
        {
          id: updatedLine.id,
          claimId: partialClaimId,
          qtyApproved: 6,
        },
        updatedLine.updatedAt,
      )
      expect(invalidApprove.status(), 'qtyApproved above qtyClaimed should be rejected').toBe(400)

      const closedClaim = await createClaimFixture(request, token, {
        claimType: 'warranty',
        customerName: `QA WC Closed ${stamp}`,
        reasonCode: 'defective',
        currencyCode: 'USD',
        lines: [
          {
            lineNo: 1,
            sku: `WC-002-CLOSED-${stamp}`,
            productName: 'QA closed claim part',
            serialNumber: `SER-CLOSED-${stamp}`,
            faultDescription: 'Closed claim line lock',
            qtyClaimed: 1,
            creditAmount: 30,
          },
        ],
      })
      closedClaimId = closedClaim.id
      const [closedLine] = await listClaimLines(request, token, closedClaimId!)
      let lifecycleClaim = await submitAndExpect(request, token, closedClaim)
      lifecycleClaim = await transitionAndExpect(request, token, lifecycleClaim, 'in_review')
      lifecycleClaim = await transitionAndExpect(request, token, lifecycleClaim, 'approved')
      lifecycleClaim = await transitionAndExpect(request, token, lifecycleClaim, 'awaiting_return')
      lifecycleClaim = await transitionAndExpect(request, token, lifecycleClaim, 'received')
      lifecycleClaim = await transitionAndExpect(request, token, lifecycleClaim, 'inspecting')
      await resolveLineThroughLifecycle(request, token, closedClaimId!, closedLine.id!, {
        qtyApproved: 1,
        qtyReceived: 1,
        creditAmount: 30,
      })
      lifecycleClaim = await transitionAndExpect(request, token, lifecycleClaim, 'resolved', {
        resolutionSummary: `Resolved ${stamp}`,
      })
      lifecycleClaim = await transitionAndExpect(request, token, lifecycleClaim, 'closed')
      expect(lifecycleClaim.status).toBe('closed')

      const closedLineReadback = (await listClaimLines(request, token, closedClaimId!))[0]
      const lockedMutation = await updateClaimLine(
        request,
        token,
        {
          id: closedLineReadback.id,
          claimId: closedClaimId,
          inspectionNotes: `Should be locked ${stamp}`,
        },
        closedLineReadback.updatedAt,
      )
      expect(lockedMutation.status(), 'line mutation on a closed claim should be rejected').toBe(400)
    } finally {
      await cleanupDraftClaimWithLines(request, token, partialClaimId)
      await cancelThenDeleteClaimIfPossible(request, token, closedClaimId)
    }
  })

  test('refuses a stale per-line optimistic-lock update with HTTP 409', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-002-stale-line')

    let claimId: string | null = null

    try {
      const claim = await createClaimFixture(request, token, {
        claimType: 'warranty',
        customerName: `QA WC Line Lock ${stamp}`,
        reasonCode: 'defective',
        currencyCode: 'USD',
        lines: [
          {
            lineNo: 1,
            sku: `WC-002-LOCK-${stamp}`,
            productName: 'QA line lock part',
            serialNumber: `SER-LOCK-${stamp}`,
            faultDescription: 'Line optimistic lock coverage',
            qtyClaimed: 1,
            creditAmount: 20,
          },
        ],
      })
      claimId = claim.id
      const [line] = await listClaimLines(request, token, claimId!)
      expect(line?.id, 'created claim should have a line').toBeTruthy()
      expect(line.updatedAt, 'line readback should include updatedAt').toBeTruthy()
      const originalUpdatedAt = line.updatedAt

      await new Promise((resolve) => setTimeout(resolve, 5))
      const firstUpdate = await updateClaimLine(
        request,
        token,
        {
          id: line.id,
          claimId,
          inspectionNotes: `Fresh line edit ${stamp}`,
        },
        originalUpdatedAt,
      )
      expect(firstUpdate.status(), 'fresh line update should return 200').toBe(200)

      const [updatedLine] = await listClaimLines(request, token, claimId!)
      expect(updatedLine.updatedAt, 'line update should refresh updatedAt').toBeTruthy()
      expect(updatedLine.updatedAt).not.toBe(originalUpdatedAt)

      const staleUpdate = await updateClaimLine(
        request,
        token,
        {
          id: line.id,
          claimId,
          inspectionNotes: `Stale line edit ${stamp}`,
        },
        originalUpdatedAt,
      )
      expect(staleUpdate.status(), 'stale line update should return 409').toBe(409)
      const staleBody = await readJsonSafe<Record<string, unknown>>(staleUpdate)
      expect(staleBody).toMatchObject({
        code: 'optimistic_lock_conflict',
        expectedUpdatedAt: originalUpdatedAt,
      })
    } finally {
      await cleanupDraftClaimWithLines(request, token, claimId)
    }
  })
})
