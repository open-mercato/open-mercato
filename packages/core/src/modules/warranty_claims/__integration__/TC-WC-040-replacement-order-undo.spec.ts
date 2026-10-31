import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createOrderLineFixture, createSalesOrderFixture, deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import {
  cancelThenDeleteClaimIfPossible, createClaimFixture, listClaimLines, readClaim,
  readWarrantyClaimSettings, requestJson, restoreWarrantyClaimSettings, saveWarrantyClaimSettings,
  submitAndExpect, transitionAndExpect, uniqueLabel, updateClaimLine,
} from './helpers'

type AuditAction = { id: string; commandId: string; undoToken: string | null; executionState: string }

async function readOrder(request: APIRequestContext, token: string, orderId: string) {
  const response = await apiRequest(request, 'GET', `/api/sales/orders?id=${orderId}`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items: Array<Record<string, unknown>> }>(response)
  return body?.items?.[0] ?? null
}

async function replacementLog(request: APIRequestContext, token: string, claimId: string) {
  const response = await apiRequest(request, 'GET', `/api/audit_logs/audit-logs/actions?resourceKind=warranty_claims.claim&resourceId=${claimId}&pageSize=100`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items: AuditAction[] }>(response)
  const log = body?.items.find((entry) => entry.commandId === 'warranty_claims.claim.create_replacement_order' && entry.executionState === 'done')
  expect(log?.undoToken).toBeTruthy()
  return log!
}

test.describe('TC-WC-040: replacement-order undo after approval initialization', () => {
  for (const edited of [false, true]) {
    test(edited ? 'preserves a replacement order edited by a user and translates the refusal' : 'undoes and redoes a replacement order initialized by the stock approval workflow', async ({ request }) => {
      const token = await getAuthToken(request, 'admin')
      const settings = await readWarrantyClaimSettings(request, token)
      let sourceOrderId: string | null = null
      let claimId: string | null = null
      const replacementIds = new Set<string>()
      try {
        await saveWarrantyClaimSettings(request, token, { autoApproveEnabled: false }, settings.updatedAt)
        sourceOrderId = await createSalesOrderFixture(request, token)
        const orderLineId = await createOrderLineFixture(request, token, sourceOrderId, { name: uniqueLabel('replacement-undo'), quantity: 2 })
        let claim = await createClaimFixture(request, token, {
          claimType: 'return', channel: 'staff', orderId: sourceOrderId, currencyCode: 'USD',
          lines: [{ lineNo: 1, productName: 'Replacement undo fixture', qtyClaimed: 1, orderLineId }],
        })
        claimId = claim.id!
        claim = await submitAndExpect(request, token, claim)
        claim = await transitionAndExpect(request, token, claim, 'in_review')
        const [line] = await listClaimLines(request, token, claimId)
        const approve = await updateClaimLine(request, token, {
          id: line.id, claimId, lineStatus: 'approved', qtyApproved: 1, disposition: 'replace',
        }, line.updatedAt)
        expect(approve.status(), await approve.text()).toBe(200)
        claim = await transitionAndExpect(request, token, await readClaim(request, token, claimId), 'approved')
        const created = await apiRequest(request, 'POST', '/api/warranty_claims/replacement-order', {
          token, data: { claimId, updatedAt: claim.updatedAt },
        })
        const result = await readJsonSafe<{ replacementOrderId: string }>(created)
        if (result?.replacementOrderId) replacementIds.add(result.replacementOrderId)
        expect(created.status()).toBe(200)
        expect(result?.replacementOrderId).toBeTruthy()
        const replacementId = result!.replacementOrderId
        await expect.poll(async () => (await readOrder(request, token, replacementId))?.status).toBe('pending_approval')
        const log = await replacementLog(request, token, claimId)
        if (edited) {
          const current = (await readOrder(request, token, replacementId))!
          const version = current.updatedAt ?? current.updated_at
          expect(typeof version).toBe('string')
          const update = await requestJson(request, 'PUT', '/api/sales/orders', token, {
            id: replacementId, internalNotes: 'Preserve this user edit',
          }, version as string)
          expect(update.status(), await update.text()).toBe(200)
        }
        const undo = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', { token, data: { undoToken: log.undoToken } })
        if (edited) {
          expect(undo.status()).toBe(409)
          const body = await readJsonSafe<{ error: string }>(undo)
          expect(body?.error).toBeTruthy()
          expect(body?.error).not.toContain('warranty_claims.errors.')
          expect((await readClaim(request, token, claimId)).replacementOrderId).toBe(replacementId)
          expect(await readOrder(request, token, replacementId)).toBeTruthy()
        } else {
          expect(undo.status(), await undo.text()).toBe(200)
          expect((await readClaim(request, token, claimId)).replacementOrderId).toBeNull()
          expect(await readOrder(request, token, replacementId)).toBeNull()
          const redo = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/redo', { token, data: { logId: log.id } })
          const relinked = await readClaim(request, token, claimId)
          if (relinked.replacementOrderId) replacementIds.add(relinked.replacementOrderId)
          expect(redo.status(), await redo.text()).toBe(200)
          expect(relinked.replacementOrderId).toBeTruthy()
          expect(await readOrder(request, token, relinked.replacementOrderId!)).toBeTruthy()
        }
      } finally {
        try {
          await cancelThenDeleteClaimIfPossible(request, token, claimId)
          for (const orderId of replacementIds) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
          if (sourceOrderId) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', sourceOrderId)
        } finally {
          await restoreWarrantyClaimSettings(request, token, settings)
        }
      }
    })
  }
})
