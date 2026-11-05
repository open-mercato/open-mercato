import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  cancelThenDeleteClaimIfPossible,
  cleanupDraftClaimWithLines,
  createClaimFixture,
  listClaimLines,
  readClaim,
  readWarrantyClaimSettings,
  resolveLineThroughLifecycle,
  restoreWarrantyClaimSettings,
  saveWarrantyClaimSettings,
  submitAndExpect,
  transitionAndExpect,
  transitionClaim,
  uniqueLabel,
} from './helpers'

function timestamp(value: string | null, label: string): number {
  expect(value, `${label} should be present`).toBeTruthy()
  const parsed = Date.parse(value as string)
  expect(Number.isNaN(parsed), `${label} should be an ISO timestamp`).toBe(false)
  return parsed
}

test.describe('TC-WC-008: warranty claim SLA v2 and reopen', () => {
  test('stamps submit SLA due date, pauses on info_requested, and shifts due date on resume', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const settingsBefore = await readWarrantyClaimSettings(request, token)
    const stamp = uniqueLabel('tc-wc-008-sla')
    const slaHours = 3
    let claimId: string | null = null

    try {
      await saveWarrantyClaimSettings(request, token, {
        slaHours,
        slaPauseOnInfoRequested: true,
        autoApproveEnabled: false,
        autoApproveMaxAmount: null,
        autoApproveCurrencyCode: null,
        autoApproveRequireInWarranty: true,
      }, settingsBefore.updatedAt)

      let claim = await createClaimFixture(request, token, {
        claimType: 'warranty',
        customerName: `QA WC SLA ${stamp}`,
        reasonCode: 'defective',
        currencyCode: 'USD',
      })
      claimId = claim.id

      claim = await submitAndExpect(request, token, claim)
      const submittedAt = timestamp(claim.submittedAt, 'submittedAt')
      const initialDueAt = timestamp(claim.slaDueAt, 'slaDueAt after submit')
      const expectedDueDelta = slaHours * 60 * 60 * 1000
      expect(
        Math.abs((initialDueAt - submittedAt) - expectedDueDelta),
        'slaDueAt should be submittedAt plus the configured SLA hours',
      ).toBeLessThan(5000)

      claim = await transitionAndExpect(request, token, claim, 'in_review')
      claim = await transitionAndExpect(request, token, claim, 'info_requested')
      const pausedDueAt = timestamp(claim.slaDueAt, 'slaDueAt while paused')
      const pausedAt = timestamp(claim.slaPausedAt, 'slaPausedAt')
      expect(pausedDueAt).toBe(initialDueAt)

      await new Promise((resolve) => setTimeout(resolve, 1100))

      claim = await transitionAndExpect(request, token, claim, 'in_review')
      expect(claim.slaPausedAt, 'leaving info_requested should clear slaPausedAt').toBeNull()
      const resumedDueAt = timestamp(claim.slaDueAt, 'slaDueAt after resume')
      expect(resumedDueAt, 'resume should shift the due date later by the paused duration').toBeGreaterThan(pausedDueAt)
      expect(resumedDueAt - pausedDueAt, 'resume shift should be close to the elapsed paused duration').toBeLessThan(20_000)
      expect(resumedDueAt - pausedDueAt, 'resume shift should be at least the observed pause').toBeGreaterThanOrEqual(1000)
      expect(Date.now() - pausedAt, 'test should have observed a real paused interval').toBeGreaterThanOrEqual(1000)
    } finally {
      await restoreWarrantyClaimSettings(request, token, settingsBefore)
      await cancelThenDeleteClaimIfPossible(request, token, claimId)
    }
  })

  test('does not pause SLA when slaPauseOnInfoRequested is disabled', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const settingsBefore = await readWarrantyClaimSettings(request, token)
    const stamp = uniqueLabel('tc-wc-008-no-pause')
    let claimId: string | null = null

    try {
      await saveWarrantyClaimSettings(request, token, {
        slaHours: 2,
        slaPauseOnInfoRequested: false,
        autoApproveEnabled: false,
        autoApproveMaxAmount: null,
        autoApproveCurrencyCode: null,
        autoApproveRequireInWarranty: true,
      }, settingsBefore.updatedAt)

      let claim = await createClaimFixture(request, token, {
        claimType: 'warranty',
        customerName: `QA WC SLA No Pause ${stamp}`,
        reasonCode: 'defective',
        currencyCode: 'USD',
      })
      claimId = claim.id

      claim = await submitAndExpect(request, token, claim)
      const dueBeforeInfoRequest = claim.slaDueAt
      claim = await transitionAndExpect(request, token, claim, 'in_review')
      claim = await transitionAndExpect(request, token, claim, 'info_requested')
      expect(claim.slaPausedAt, 'disabled pause setting should leave slaPausedAt null').toBeNull()
      expect(claim.slaDueAt, 'disabled pause setting should not shift slaDueAt on entry').toBe(dueBeforeInfoRequest)
    } finally {
      await restoreWarrantyClaimSettings(request, token, settingsBefore)
      await cancelThenDeleteClaimIfPossible(request, token, claimId)
    }
  })

  test('allows closed claims to reopen and keeps cancelled claims terminal', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const settingsBefore = await readWarrantyClaimSettings(request, token)
    const stamp = uniqueLabel('tc-wc-008-reopen')
    let closedClaimId: string | null = null
    let cancelledClaimId: string | null = null

    try {
      await saveWarrantyClaimSettings(request, token, {
        slaPauseOnInfoRequested: true,
        autoApproveEnabled: false,
        autoApproveMaxAmount: null,
        autoApproveCurrencyCode: null,
        autoApproveRequireInWarranty: true,
      }, settingsBefore.updatedAt)

      let closed = await createClaimFixture(request, token, {
        claimType: 'warranty',
        customerName: `QA WC Reopen ${stamp}`,
        reasonCode: 'defective',
        currencyCode: 'USD',
        lines: [
          {
            lineNo: 1,
            sku: `WC-008-REOPEN-${stamp}`,
            productName: 'QA reopen part',
            serialNumber: `SER-REOPEN-${stamp}`,
            faultDescription: 'Lifecycle reopen coverage',
            qtyClaimed: 1,
            creditAmount: 25,
          },
        ],
      })
      closedClaimId = closed.id
      const [line] = await listClaimLines(request, token, closedClaimId!)

      closed = await submitAndExpect(request, token, closed)
      closed = await transitionAndExpect(request, token, closed, 'in_review')
      closed = await transitionAndExpect(request, token, closed, 'approved')
      await resolveLineThroughLifecycle(request, token, closedClaimId!, line.id!, {
        qtyApproved: 1,
        qtyReceived: 1,
        creditAmount: 25,
      })
      closed = await readClaim(request, token, closedClaimId!)
      closed = await transitionAndExpect(request, token, closed, 'resolved', {
        resolutionSummary: `Resolved before reopen ${stamp}`,
      })
      closed = await transitionAndExpect(request, token, closed, 'closed')
      closed = await transitionAndExpect(request, token, closed, 'in_review')
      expect(closed.status, 'closed -> in_review should be the supported reopen transition').toBe('in_review')

      let cancelled = await createClaimFixture(request, token, {
        claimType: 'return',
        customerName: `QA WC Cancelled Terminal ${stamp}`,
        reasonCode: 'damaged',
        currencyCode: 'USD',
      })
      cancelledClaimId = cancelled.id
      cancelled = await transitionAndExpect(request, token, cancelled, 'cancelled')
      const terminalMove = await transitionClaim(
        request,
        token,
        { id: cancelledClaimId!, toStatus: 'submitted' },
        cancelled.updatedAt,
      )
      expect(terminalMove.status(), 'cancelled claims should reject any subsequent transition').toBe(400)
    } finally {
      await restoreWarrantyClaimSettings(request, token, settingsBefore)
      await cancelThenDeleteClaimIfPossible(request, token, closedClaimId)
      await cleanupDraftClaimWithLines(request, token, cancelledClaimId)
    }
  })
})
