import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  cancelThenDeleteClaimIfPossible,
  cleanupDraftClaimWithLines,
  createClaimFixture,
  createClaimLine,
  expectClaimStatus,
  listClaimLines,
  numeric,
  OPTIMISTIC_LOCK_HEADER,
  resolveLineThroughLifecycle,
  submitAndExpect,
  transitionAndExpect,
  uniqueLabel,
  updateClaimLine,
} from './helpers'

test.describe('TC-WC-002: warranty claim line partial approvals', () => {
  for (const role of ['admin', 'employee'] as const) {
    test(`${role} can cancel then confirm removing a line from the desk (#8012)`, async ({ page, request }) => {
      const token = await getAuthToken(request, 'admin')
      const stamp = uniqueLabel('tc-wc-002-remove')
      let claimId: string | null = null
      try {
        const claim = await createClaimFixture(request, token, {
          claimType: 'return',
          customerName: `QA WC Remove ${stamp}`,
          reasonCode: 'defective',
          currencyCode: 'USD',
          lines: [
            { productName: `Keep ${stamp}`, qtyClaimed: 1, creditAmount: 10 },
            { productName: `Remove ${stamp}`, qtyClaimed: 1, creditAmount: 20 },
          ],
        })
        claimId = claim.id
        const initialLines = await listClaimLines(request, token, claimId!)
        const removedLine = initialLines.find((line) => line.productName === `Remove ${stamp}`)
        expect(removedLine?.updatedAt).toBeTruthy()
        await login(page, role)
        await page.goto(`/backend/warranty_claims/${claimId}`)
        const row = page.getByRole('row').filter({ hasText: `Remove ${stamp}` })
        await row.getByRole('button', { name: 'Open actions' }).click()
        await page.getByRole('menuitem', { name: 'Remove line', exact: true }).click()
        const confirmation = page.getByRole('dialog', { name: 'Remove line', exact: true })
        await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
        await expect(row).toBeVisible()
        expect(await listClaimLines(request, token, claimId!)).toHaveLength(2)

        await row.getByRole('button', { name: 'Open actions' }).click()
        await page.getByRole('menuitem', { name: 'Remove line', exact: true }).click()
        const deletion = page.waitForResponse((response) =>
          new URL(response.url()).pathname === '/api/warranty_claims/lines'
          && response.request().method() === 'DELETE',
        )
        await confirmation.getByRole('button', { name: 'Confirm', exact: true }).click()
        const response = await deletion
        expect(response.status()).toBe(200)
        expect(response.request().headers()[OPTIMISTIC_LOCK_HEADER]).toBe(removedLine?.updatedAt)
        expect(response.request().postDataJSON()).toMatchObject({ id: removedLine?.id, claimId })
        await expect(row).toHaveCount(0)
        await expect(page.getByRole('row').filter({ hasText: `Keep ${stamp}` })).toBeVisible()
        const remaining = await listClaimLines(request, token, claimId!)
        expect(remaining).toHaveLength(1)
        expect(remaining[0].productName).toBe(`Keep ${stamp}`)
        const updatedClaim = await expectClaimStatus(request, token, claimId!, 'draft')
        expect(numeric(updatedClaim.totalClaimedAmount)).toBe(10)
      } finally {
        await cleanupDraftClaimWithLines(request, token, claimId)
      }
    })
  }

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
      // LINE-05: restocking fee and core credit are return-family adjustments. This is a
      // `warranty` claim, so the approved total settles on the credit amount alone and must
      // NOT become 100 - 5 + 10 = 105.
      expect(numeric(rolledUp.totalApprovedAmount), 'warranty approved total should ignore restock/core adjustments').toBe(100)

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

      const invalidReceived = await updateClaimLine(
        request,
        token,
        {
          id: updatedLine.id,
          claimId: partialClaimId,
          qtyReceived: 6,
        },
        updatedLine.updatedAt,
      )
      expect(invalidReceived.status(), 'qtyReceived above qtyClaimed should be rejected').toBe(400)

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

  test('auto-assigns the next line number when creating an additional line without lineNo', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-002-line-no')

    let claimId: string | null = null

    try {
      const claim = await createClaimFixture(request, token, {
        claimType: 'warranty',
        customerName: `QA WC Line Numbers ${stamp}`,
        reasonCode: 'defective',
        currencyCode: 'USD',
        lines: [
          {
            lineNo: 1,
            sku: `WC-002-LNO-A-${stamp}`,
            productName: 'QA line number first part',
            serialNumber: `SER-LNO-A-${stamp}`,
            faultDescription: 'First line for line number coverage',
            qtyClaimed: 1,
            creditAmount: 10,
          },
        ],
      })
      claimId = claim.id

      const created = await createClaimLine(
        request,
        token,
        {
          claimId,
          sku: `WC-002-LNO-B-${stamp}`,
          productName: 'QA line number second part',
          serialNumber: `SER-LNO-B-${stamp}`,
          faultDescription: 'Second line should receive max+1 lineNo',
          qtyClaimed: 1,
          creditAmount: 12,
        },
        claim.updatedAt,
      )
      expect(created.status(), 'line create without lineNo should return 201').toBe(201)

      const lines = await listClaimLines(request, token, claimId!)
      expect(lines, 'claim should have two lines after lines-API create').toHaveLength(2)
      const lineNumbers = lines.map((line) => line.lineNo ?? 0).sort((left, right) => left - right)
      expect(lineNumbers).toEqual([1, 2])
      expect(Math.max(...lineNumbers), 'created line number should be greater than the existing max before create').toBeGreaterThan(1)
    } finally {
      await cleanupDraftClaimWithLines(request, token, claimId)
    }
  })
})
