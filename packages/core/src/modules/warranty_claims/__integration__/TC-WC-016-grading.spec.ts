import { expect, test } from '@playwright/test'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  cancelThenDeleteClaimIfPossible,
  createClaimFixture,
  listClaimLines,
  readClaim,
  readClaimEvents,
  readClaimLine,
  receiveClaimLine,
  submitAndExpect,
  transitionAndExpect,
  updateClaimLine,
  uniqueLabel,
} from './helpers'

test.describe('TC-WC-016: warranty claim receiving grading', () => {
  test('records condition grade, writes timeline, and rejects restock for C/D graded lines', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-016')
    let claimId: string | null = null

    try {
      let claim = await createClaimFixture(request, adminToken, {
        claimType: 'warranty',
        customerName: `QA WC Grading ${stamp}`,
        reasonCode: 'defective',
        currencyCode: 'USD',
        lines: [
          {
            lineNo: 1,
            sku: `WC-016-${stamp}`,
            productName: 'QA grading product',
            serialNumber: `SER-016-${stamp}`,
            faultDescription: 'Needs receiving grade',
            qtyClaimed: 1,
            creditAmount: 22,
          },
        ],
      })
      claimId = claim.id
      const [line] = await listClaimLines(request, adminToken, claim.id!)
      expect(line?.id, 'created claim should include a line').toBeTruthy()

      claim = await submitAndExpect(request, adminToken, claim)
      claim = await transitionAndExpect(request, adminToken, claim, 'in_review')
      claim = await transitionAndExpect(request, adminToken, claim, 'approved')
      claim = await transitionAndExpect(request, adminToken, claim, 'awaiting_return')
      claim = await transitionAndExpect(request, adminToken, claim, 'received')

      const lineBeforeReceive = await readClaimLine(request, adminToken, claim.id!, line.id!)
      expect(
        lineBeforeReceive.updatedAt,
        'lifecycle transitions bump the claim version only, so the line must carry its own',
      ).not.toBe(claim.updatedAt)

      const receiveResponse = await receiveClaimLine(request, adminToken, {
        lineId: line.id!,
        conditionGrade: 'C',
        inspectionNotes: `Grade C inspection ${stamp}`,
        updatedAt: lineBeforeReceive.updatedAt,
      })
      const receiveBody = await readJsonSafe<{ ok?: boolean; lineId?: string | null }>(receiveResponse)
      expect(receiveResponse.status(), `receiving grade should return 200: ${JSON.stringify(receiveBody)}`).toBe(200)
      expect(receiveBody?.lineId).toBe(line.id)

      const events = await readClaimEvents(request, adminToken, claim.id!)
      expect(
        events.some(
          (event) =>
            event.kind === 'system'
            && event.payload?.action === 'line_received'
            && event.payload?.lineId === line.id
            && event.payload?.conditionGrade === 'C',
        ),
        'receiving should append a line_received timeline event with conditionGrade C',
      ).toBe(true)

      const gradedLine = await readClaimLine(request, adminToken, claim.id!, line.id!)
      const restockResponse = await updateClaimLine(
        request,
        adminToken,
        {
          id: line.id,
          claimId: claim.id,
          disposition: 'restock',
        },
        gradedLine.updatedAt,
      )
      const restockBody = await readJsonSafe<{ error?: string }>(restockResponse)
      expect(
        restockResponse.status(),
        `C-graded lines should reject restock: ${JSON.stringify(restockBody)}`,
      ).toBe(400)
      expect(restockBody?.error).toBe('warranty_claims.errors.dispositionGradeConflict')

      const finalClaim = await readClaim(request, adminToken, claim.id!)
      expect(finalClaim.status).toBe('received')
    } finally {
      await cancelThenDeleteClaimIfPossible(request, adminToken, claimId)
    }
  })
})
