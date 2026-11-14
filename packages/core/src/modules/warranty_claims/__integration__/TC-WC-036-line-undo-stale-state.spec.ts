import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  expectOperation,
  redoOk,
  skipIfUndoTestsDisabled,
  undoByToken,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'
import {
  cancelThenDeleteClaimIfPossible,
  createClaimFixture,
  listClaimLines,
  numeric,
  readClaim,
  readClaimLine,
  readWarrantyClaimSettings,
  receiveClaimLine,
  restoreWarrantyClaimSettings,
  saveWarrantyClaimSettings,
  submitAndExpect,
  transitionAndExpect,
  uniqueLabel,
  updateClaimLine,
  type ClaimItem,
  type WarrantyClaimSettingsResult,
} from './helpers'

type UndoRefusalBody = {
  error?: string
  code?: string
}

async function saveQuarantineSettings(
  request: APIRequestContext,
  token: string,
  current: WarrantyClaimSettingsResult,
): Promise<void> {
  await saveWarrantyClaimSettings(request, token, {
    slaHours: current.slaHours,
    slaPauseOnInfoRequested: current.slaPauseOnInfoRequested,
    slaAtRiskThresholdPct: current.slaAtRiskThresholdPct,
    autoApproveEnabled: current.autoApproveEnabled,
    autoApproveMaxAmount: current.autoApproveMaxAmount,
    autoApproveCurrencyCode: current.autoApproveCurrencyCode,
    autoApproveRequireInWarranty: current.autoApproveRequireInWarranty,
    defaultWarrantyMonths: current.defaultWarrantyMonths,
    businessHours: current.businessHours,
    escalationTiers: current.escalationTiers,
    adjudicationUseRules: current.adjudicationUseRules,
    quarantineGrades: ['D'],
    returnLabelProvider: current.returnLabelProvider,
  }, current.updatedAt)
}

function claimTotals(claim: ClaimItem): { claimed: number; approved: number } {
  return { claimed: numeric(claim.totalClaimedAmount), approved: numeric(claim.totalApprovedAmount) }
}

async function createSingleLineClaim(
  request: APIRequestContext,
  token: string,
  stamp: string,
  input: { claimType: 'return'; reasonCode: string; creditAmount: number },
): Promise<{ claim: ClaimItem; lineId: string }> {
  const claim = await createClaimFixture(request, token, {
    claimType: input.claimType,
    customerName: `QA WC Line Undo ${stamp}`,
    reasonCode: input.reasonCode,
    currencyCode: 'USD',
    lines: [
      {
        lineNo: 1,
        sku: `WC-036-${stamp}`,
        productName: 'QA line undo product',
        faultDescription: 'Line undo staleness fixture',
        qtyClaimed: 1,
        creditAmount: input.creditAmount,
      },
    ],
  })
  const [line] = await listClaimLines(request, token, claim.id!)
  expect(line?.id, 'created claim should include a line').toBeTruthy()
  return { claim, lineId: line.id! }
}

async function expectUndoRefused(
  request: APIRequestContext,
  token: string,
  undoToken: string,
  code: string,
  context: string,
): Promise<void> {
  const response = await undoByToken(request, token, undoToken)
  const body = await readJsonSafe<UndoRefusalBody>(response)
  expect(response.status(), `${context}: undo must be refused with 409, got ${JSON.stringify(body)}`).toBe(409)
  expect(body?.code, `${context}: refusal code`).toBe(code)
  expect(body?.error, `${context}: refusal message should be present`).toBeTruthy()
  expect(body?.error, `${context}: refusal message should be localized, not the raw key`).not.toBe(code)
}

test.describe('TC-WC-036: claim-line undo refuses stale state and keeps header totals consistent', () => {
  test.beforeEach(() => {
    skipIfUndoTestsDisabled()
  })

  test('undo of a line update is refused after another user quarantines the line', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    expect(
      getTokenScope(employeeToken).organizationId,
      'the seeded employee must work in the admin organization to receive its claim line',
    ).toBe(getTokenScope(adminToken).organizationId)
    const stamp = uniqueLabel('tc-wc-036-quarantine')
    const settingsBefore = await readWarrantyClaimSettings(request, adminToken)
    let claimId: string | null = null

    try {
      await saveQuarantineSettings(request, adminToken, settingsBefore)
      const fixture = await createSingleLineClaim(request, adminToken, stamp, {
        claimType: 'return',
        reasonCode: 'damaged',
        creditAmount: 18,
      })
      claimId = fixture.claim.id
      const lineId = fixture.lineId
      let claim = await submitAndExpect(request, adminToken, fixture.claim)
      claim = await transitionAndExpect(request, adminToken, claim, 'in_review')
      claim = await transitionAndExpect(request, adminToken, claim, 'approved')
      claim = await transitionAndExpect(request, adminToken, claim, 'awaiting_return')
      claim = await transitionAndExpect(request, adminToken, claim, 'received')

      const lineBeforeUpdate = await readClaimLine(request, adminToken, claimId!, lineId)
      const updateResponse = await updateClaimLine(
        request,
        adminToken,
        { id: lineId, claimId, inspectionNotes: `Bench tested ${stamp}` },
        lineBeforeUpdate.updatedAt,
      )
      expect(updateResponse.status(), 'admin line update should return 200').toBe(200)
      const operation = expectOperation(updateResponse, 'admin line update')

      const lineBeforeReceive = await readClaimLine(request, adminToken, claimId!, lineId)
      const receiveResponse = await receiveClaimLine(request, employeeToken, {
        lineId,
        conditionGrade: 'D',
        updatedAt: lineBeforeReceive.updatedAt,
      })
      const receiveBody = await readJsonSafe<Record<string, unknown>>(receiveResponse)
      expect(receiveResponse.status(), `employee receive should return 200: ${JSON.stringify(receiveBody)}`).toBe(200)

      const heldLine = await readClaimLine(request, adminToken, claimId!, lineId)
      expect(heldLine.conditionGrade).toBe('D')
      expect(heldLine.quarantineStatus).toBe('held')
      const claimBeforeUndo = await readClaim(request, adminToken, claimId!)

      await expectUndoRefused(request, adminToken, operation.undoToken, 'warranty_claims.errors.conflict', 'stale line update undo')

      const lineAfterUndo = await readClaimLine(request, adminToken, claimId!, lineId)
      expect(lineAfterUndo.conditionGrade, 'the refused undo must keep the received grade').toBe('D')
      expect(lineAfterUndo.quarantineStatus, 'the refused undo must keep the quarantine hold').toBe('held')
      expect(lineAfterUndo.inspectionNotes).toBe(heldLine.inspectionNotes)
      expect(lineAfterUndo.updatedAt, 'the refused undo must not write the line').toBe(heldLine.updatedAt)
      const claimAfterUndo = await readClaim(request, adminToken, claimId!)
      expect(claimTotals(claimAfterUndo)).toEqual(claimTotals(claimBeforeUndo))
      expect(claimAfterUndo.updatedAt, 'the refused undo must not write the claim').toBe(claimBeforeUndo.updatedAt)
    } finally {
      await restoreWarrantyClaimSettings(request, adminToken, settingsBefore)
      await cancelThenDeleteClaimIfPossible(request, adminToken, claimId)
    }
  })

  test('undo of a line credit edit restores the line and header totals, and redo re-applies it', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-036-roundtrip')
    let claimId: string | null = null

    try {
      const fixture = await createSingleLineClaim(request, adminToken, stamp, {
        claimType: 'return',
        reasonCode: 'damaged',
        creditAmount: 10,
      })
      claimId = fixture.claim.id
      const lineId = fixture.lineId
      const claimBefore = await readClaim(request, adminToken, claimId!)
      const lineBefore = await readClaimLine(request, adminToken, claimId!, lineId)
      expect(numeric(lineBefore.creditAmount)).toBe(10)
      expect(claimTotals(claimBefore).claimed).toBe(10)

      const updateResponse = await updateClaimLine(
        request,
        adminToken,
        { id: lineId, claimId, creditAmount: 25 },
        lineBefore.updatedAt,
      )
      expect(updateResponse.status(), 'line credit update should return 200').toBe(200)
      const operation = expectOperation(updateResponse, 'line credit update')
      const claimAfterUpdate = await readClaim(request, adminToken, claimId!)
      expect(claimTotals(claimAfterUpdate).claimed).toBe(25)

      await undoOk(request, adminToken, operation.undoToken, 'line credit update')

      const lineAfterUndo = await readClaimLine(request, adminToken, claimId!, lineId)
      const claimAfterUndo = await readClaim(request, adminToken, claimId!)
      expect(numeric(lineAfterUndo.creditAmount), 'undo restores the line credit').toBe(10)
      expect(claimTotals(claimAfterUndo), 'undo recomputes the header totals from the restored line').toEqual(claimTotals(claimBefore))

      await redoOk(request, adminToken, operation.logId, 'line credit update')

      const lineAfterRedo = await readClaimLine(request, adminToken, claimId!, lineId)
      const claimAfterRedo = await readClaim(request, adminToken, claimId!)
      expect(numeric(lineAfterRedo.creditAmount), 'redo re-applies the line credit').toBe(25)
      expect(claimTotals(claimAfterRedo)).toEqual(claimTotals(claimAfterUpdate))
    } finally {
      await cancelThenDeleteClaimIfPossible(request, adminToken, claimId)
    }
  })

  test('undo of a line update is refused with lineLocked once the claim is closed', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-036-closed')
    let claimId: string | null = null

    try {
      const fixture = await createSingleLineClaim(request, adminToken, stamp, {
        claimType: 'return',
        reasonCode: 'damaged',
        creditAmount: 20,
      })
      claimId = fixture.claim.id
      const lineId = fixture.lineId
      let claim = await submitAndExpect(request, adminToken, fixture.claim)
      claim = await transitionAndExpect(request, adminToken, claim, 'in_review')
      claim = await transitionAndExpect(request, adminToken, claim, 'approved')

      let line = await readClaimLine(request, adminToken, claimId!, lineId)
      const approveResponse = await updateClaimLine(
        request,
        adminToken,
        { id: lineId, claimId, lineStatus: 'approved', qtyApproved: 1, creditAmount: 20, disposition: 'credit' },
        line.updatedAt,
      )
      expect(approveResponse.status(), 'line pending -> approved should return 200').toBe(200)

      line = await readClaimLine(request, adminToken, claimId!, lineId)
      const resolveResponse = await updateClaimLine(
        request,
        adminToken,
        { id: lineId, claimId, lineStatus: 'resolved', creditAmount: 12 },
        line.updatedAt,
      )
      expect(resolveResponse.status(), 'line approved -> resolved should return 200').toBe(200)
      const operation = expectOperation(resolveResponse, 'line approved -> resolved')

      claim = await readClaim(request, adminToken, claimId!)
      claim = await transitionAndExpect(request, adminToken, claim, 'resolved', {
        resolutionSummary: `Line undo closed claim ${stamp}`,
      })
      claim = await transitionAndExpect(request, adminToken, claim, 'closed')
      const lineBeforeUndo = await readClaimLine(request, adminToken, claimId!, lineId)
      const claimBeforeUndo = await readClaim(request, adminToken, claimId!)
      expect(lineBeforeUndo.lineStatus).toBe('resolved')
      expect(numeric(lineBeforeUndo.creditAmount)).toBe(12)

      await expectUndoRefused(request, adminToken, operation.undoToken, 'warranty_claims.errors.lineLocked', 'closed claim line undo')

      const lineAfterUndo = await readClaimLine(request, adminToken, claimId!, lineId)
      const claimAfterUndo = await readClaim(request, adminToken, claimId!)
      expect(lineAfterUndo.lineStatus).toBe('resolved')
      expect(numeric(lineAfterUndo.creditAmount)).toBe(12)
      expect(lineAfterUndo.updatedAt, 'the refused undo must not write the line').toBe(lineBeforeUndo.updatedAt)
      expect(claimAfterUndo.status).toBe('closed')
      expect(claimTotals(claimAfterUndo)).toEqual(claimTotals(claimBeforeUndo))
      expect(claimAfterUndo.updatedAt, 'the refused undo must not write the claim').toBe(claimBeforeUndo.updatedAt)
    } finally {
      await cancelThenDeleteClaimIfPossible(request, adminToken, claimId)
    }
  })
})
