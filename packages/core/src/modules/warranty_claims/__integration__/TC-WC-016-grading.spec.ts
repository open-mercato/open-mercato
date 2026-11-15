import { expect, test } from '@playwright/test'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  cleanupReceivingClaimFixture,
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
      expect(gradedLine.disposition).toBe('scrap')
      const editResponse = await updateClaimLine(request, adminToken, {
        id: line.id,
        claimId: claim.id,
        disposition: gradedLine.disposition,
        inspectionNotes: `Edited warranty grade C ${stamp}`,
      }, gradedLine.updatedAt)
      expect(editResponse.status(), 'an allowed grading suggestion should remain editable').toBe(200)
      const editedLine = await readClaimLine(request, adminToken, claim.id!, line.id!)
      expect(editedLine.inspectionNotes).toBe(`Edited warranty grade C ${stamp}`)
      const restockResponse = await updateClaimLine(
        request,
        adminToken,
        {
          id: line.id,
          claimId: claim.id,
          disposition: 'restock',
        },
        editedLine.updatedAt,
      )
      const restockBody = await readJsonSafe<{ error?: string }>(restockResponse)
      expect(
        restockResponse.status(),
        `C-graded lines should reject restock: ${JSON.stringify(restockBody)}`,
      ).toBe(400)
      expect(restockBody?.error).toBe('Restock is only allowed for grade A or B items.')

      const finalClaim = await readClaim(request, adminToken, claim.id!)
      expect(finalClaim.status).toBe('received')
    } finally {
      await cleanupReceivingClaimFixture(request, adminToken, claimId)
    }
  })

  for (const conditionGrade of ['A', 'B', 'C', 'D'] as const) {
    test(`return grade ${conditionGrade} remains editable after receiving`, async ({ request }) => {
      const adminToken = await getAuthToken(request, 'admin')
      const stamp = uniqueLabel(`tc-wc-016-return-${conditionGrade}`)
      let claimId: string | null = null

      try {
        let claim = await createClaimFixture(request, adminToken, {
          claimType: 'return',
          customerName: `QA return grading ${stamp}`,
          reasonCode: 'damaged',
          currencyCode: 'USD',
          lines: [{ productName: `QA grade ${conditionGrade}`, qtyClaimed: 1, creditAmount: 10 }],
        })
        claimId = claim.id
        const [line] = await listClaimLines(request, adminToken, claim.id!)
        expect(line?.id).toBeTruthy()
        claim = await submitAndExpect(request, adminToken, claim)
        for (const status of ['in_review', 'approved', 'awaiting_return', 'received']) {
          claim = await transitionAndExpect(request, adminToken, claim, status)
        }

        const before = await readClaimLine(request, adminToken, claim.id!, line.id!)
        const receiveResponse = await receiveClaimLine(request, adminToken, {
          lineId: line.id!, conditionGrade, updatedAt: before.updatedAt,
        })
        expect(receiveResponse.status(), 'return grading should succeed').toBe(200)
        const graded = await readClaimLine(request, adminToken, claim.id!, line.id!)
        const expectedDisposition = conditionGrade === 'A' ? 'restock' : null
        expect(graded.conditionGrade).toBe(conditionGrade)
        expect(graded.disposition).toBe(expectedDisposition)

        const inspectionNotes = `Edited return grade ${conditionGrade} ${stamp}`
        const editResponse = await updateClaimLine(request, adminToken, {
          id: line.id,
          claimId: claim.id,
          disposition: graded.disposition,
          qtyClaimed: 1,
          inspectionNotes,
        }, graded.updatedAt)
        const editBody = await readJsonSafe<{ error?: string }>(editResponse)
        expect(editResponse.status(), `saving the graded line should succeed: ${JSON.stringify(editBody)}`).toBe(200)
        const edited = await readClaimLine(request, adminToken, claim.id!, line.id!)
        expect(edited.inspectionNotes).toBe(inspectionNotes)
        expect(edited.conditionGrade).toBe(conditionGrade)
        expect(edited.disposition).toBe(expectedDisposition)

        const invalidResponse = await updateClaimLine(request, adminToken, {
          id: line.id, claimId: claim.id, disposition: 'scrap',
        }, edited.updatedAt)
        expect(invalidResponse.status(), 'explicit scrap must still be rejected for returns').toBe(400)
      } finally {
        await cleanupReceivingClaimFixture(request, adminToken, claimId)
      }
    })
  }
})
