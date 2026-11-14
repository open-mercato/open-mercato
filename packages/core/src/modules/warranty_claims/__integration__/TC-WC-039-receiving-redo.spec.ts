import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createClaimFixture,
  listClaimLines,
  readClaimMaybe,
  readClaimLine,
  readWarrantyClaimSettings,
  requestJson,
  restoreWarrantyClaimSettings,
  saveWarrantyClaimSettings,
  submitAndExpect,
  transitionAndExpect,
  uniqueLabel,
} from './helpers'

type AuditAction = {
  id: string
  commandId: string
  executionState: string
  undoToken: string | null
}

async function deleteReceivingFixture(request: APIRequestContext, token: string, claimId: string): Promise<void> {
  let claim = await readClaimMaybe(request, token, claimId)
  if (!claim) return
  for (const line of await listClaimLines(request, token, claimId)) {
    const response = await requestJson(request, 'DELETE', `/api/warranty_claims/lines?id=${line.id}`, token, undefined, line.updatedAt)
    expect(response.status(), await response.text()).toBe(200)
  }
  const cleanupTransitions: Record<string, string> = {
    received: 'inspecting',
    inspecting: 'resolved',
    resolved: 'closed',
    closed: 'in_review',
    in_review: 'cancelled',
    submitted: 'cancelled',
    approved: 'cancelled',
    awaiting_return: 'cancelled',
  }
  while (claim.status && cleanupTransitions[claim.status]) {
    claim = await transitionAndExpect(request, token, claim, cleanupTransitions[claim.status])
  }
  claim = (await readClaimMaybe(request, token, claimId))!
  const response = await requestJson(request, 'DELETE', `/api/warranty_claims?id=${claimId}`, token, undefined, claim.updatedAt)
  expect(response.status(), await response.text()).toBe(200)
  expect(await readClaimMaybe(request, token, claimId)).toBeNull()
}

test.describe('TC-WC-039: receiving and quarantine release redo', () => {
  for (const action of ['receive', 'release'] as const) {
    test(`redoes ${action} after undo when the original body included updatedAt`, async ({ request }) => {
      test.slow()
      const token = await getAuthToken(request, 'admin')
      const settings = await readWarrantyClaimSettings(request, token)
      let claimId: string | null = null

      try {
        await saveWarrantyClaimSettings(request, token, {
          autoApproveEnabled: false,
          ...(action === 'release' ? { quarantineGrades: ['D'] } : {}),
        }, settings.updatedAt)
        let claim = await createClaimFixture(request, token, {
          claimType: 'return',
          customerName: uniqueLabel('redo-receiving'),
          reasonCode: 'damaged',
          currencyCode: 'USD',
          lines: [{ lineNo: 1, qtyClaimed: 1, creditAmount: 9, purchaseDate: '2026-01-15', warrantyMonths: 24 }],
        })
        claimId = claim.id!
        const [createdLine] = await listClaimLines(request, token, claimId)
        const lineId = createdLine.id!
        claim = await submitAndExpect(request, token, claim)
        for (const status of ['in_review', 'approved', 'awaiting_return', 'received'] as const) {
          claim = await transitionAndExpect(request, token, claim, status)
        }

        if (action === 'release') {
          const ungraded = await readClaimLine(request, token, claimId, lineId)
          const response = await requestJson(request, 'POST', '/api/warranty_claims/receiving', token, {
            lineId, conditionGrade: 'D', updatedAt: ungraded.updatedAt,
          })
          expect(response.status(), await response.text()).toBe(200)
        }
        const before = await readClaimLine(request, token, claimId, lineId)
        expect(before.updatedAt).toBeTruthy()
        const mutation = await requestJson(request, 'POST', '/api/warranty_claims/receiving', token, {
          lineId,
          ...(action === 'receive' ? { conditionGrade: 'B' } : { action: 'release' }),
          updatedAt: before.updatedAt,
        })
        expect(mutation.status(), await mutation.text()).toBe(200)

        const actionsUrl = `/api/audit_logs/audit-logs/actions?resourceId=${lineId}`
        const logsResponse = await requestJson(request, 'GET', `${actionsUrl}&undoableOnly=true`, token)
        expect(logsResponse.status()).toBe(200)
        const logs = await readJsonSafe<{ items: AuditAction[] }>(logsResponse)
        const commandId = `warranty_claims.claim_line.${action === 'receive' ? 'receive' : 'release_quarantine'}`
        const log = logs?.items.find((entry) => entry.commandId === commandId && entry.executionState === 'done')
        expect(log?.undoToken).toBeTruthy()

        const undo = await requestJson(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', token, {
          undoToken: log!.undoToken,
        })
        expect(undo.status(), await undo.text()).toBe(200)
        const undone = await readClaimLine(request, token, claimId, lineId)
        expect(undone.updatedAt).not.toBe(before.updatedAt)
        expect(undone.conditionGrade).toBe(before.conditionGrade)
        expect(undone.quarantineStatus).toBe(before.quarantineStatus)

        const redo = await requestJson(request, 'POST', '/api/audit_logs/audit-logs/actions/redo', token, {
          logId: log!.id,
        })
        expect(redo.status(), await redo.text()).toBe(200)
        const restored = await readClaimLine(request, token, claimId, lineId)
        if (action === 'receive') expect(restored.conditionGrade).toBe('B')
        else expect(restored.quarantineStatus).toBe('released')
        expect(Number(restored.creditAmount)).toBe(9)

        const refreshedLogsResponse = await requestJson(request, 'GET', actionsUrl, token)
        expect(refreshedLogsResponse.status()).toBe(200)
        const refreshedLogs = await readJsonSafe<{ items: AuditAction[] }>(refreshedLogsResponse)
        expect(refreshedLogs?.items.find((entry) => entry.id === log!.id)?.executionState).toBe('redone')
      } finally {
        try {
          if (claimId) await deleteReceivingFixture(request, token, claimId)
        } finally {
          await restoreWarrantyClaimSettings(request, token, settings)
        }
      }
    })
  }
})
