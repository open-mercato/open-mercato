import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  DEAL_UPDATE_COMMAND_ID,
  createQaDeal,
  deleteQaDealIfExists,
  listDealAuditActions,
  redoAuditAction,
  undoAuditAction,
  updateQaDeal,
  uniqueSuffix,
} from './helpers/explainApi'
import { deleteProjectedCases, readProjectedCase, readProjectedEvents, runXrayBackfill } from './helpers/xrayApi'

/**
 * TC-INS-X02: Undo voids a projected step, redo projects a new one
 * Covers:
 *   - PUT /api/customers/deals (status change), POST /api/audit_logs/audit-logs/actions/undo, .../redo
 *   - POST /api/insights/xray/backfill (re-run after undo and after redo)
 *
 * A projected status change is never deleted: undoing it marks its event voided (attributed to
 * the undo row) and recomputes the case back to the previous status. Redoing writes a new audit
 * row, which projects a new event caused by `redo`, while the original stays voided.
 */
test.describe('TC-INS-X02: undo voids the projected step and redo adds a new one', () => {
  test('voids on undo and re-projects on redo', async ({ request }) => {
    let token: string | null = null
    let dealId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      dealId = await createQaDeal(request, token, { title: `QA INS-X02 ${uniqueSuffix()}`, status: 'open' })
      await updateQaDeal(request, token, dealId, { status: 'qa_review' })
      const update = (await listDealAuditActions(request, token, dealId)).find((item) => item.commandId === DEAL_UPDATE_COMMAND_ID)
      expect(update?.undoToken, 'the status change is undoable').toBeTruthy()

      await runXrayBackfill(request, token)
      const beforeUndo = (await readProjectedEvents(dealId)).find((event) => event.source_log_id === update?.id && event.activity_key === 'status:qa_review')
      expect(beforeUndo).toEqual(expect.objectContaining({ voided: false }))
      expect((await readProjectedCase(dealId))?.dimensions.stages?.status).toBe('qa_review')

      await undoAuditAction(request, token, update?.undoToken as string)
      await runXrayBackfill(request, token)
      const afterUndo = (await readProjectedEvents(dealId)).find((event) => event.source_log_id === update?.id && event.activity_key === 'status:qa_review')
      expect(afterUndo, 'the undone step is kept but voided').toEqual(expect.objectContaining({ voided: true }))
      expect(afterUndo?.voided_by_log_id, 'the void is attributed to the undo row').toBeTruthy()
      const undoneCase = await readProjectedCase(dealId)
      expect(undoneCase?.dimensions.stages?.status, 'the case falls back to the previous status').toBe('open')
      expect(undoneCase?.variant_keys).not.toContain('status:qa_review')

      const redoLogId = await redoAuditAction(request, token, update?.id as string)
      await runXrayBackfill(request, token)
      const events = await readProjectedEvents(dealId)
      const redone = events.find((event) => event.source_log_id === redoLogId && event.activity_key === 'status:qa_review')
      expect(redone, 'the redo projects a new step').toEqual(expect.objectContaining({ voided: false, cause_kind: 'redo' }))
      expect(events.find((event) => event.source_log_id === update?.id && event.activity_key === 'status:qa_review')?.voided).toBe(true)
      expect((await readProjectedCase(dealId))?.dimensions.stages?.status).toBe('qa_review')
    } finally {
      await deleteQaDealIfExists(request, token, dealId)
      await deleteProjectedCases([dealId])
    }
  })
})
