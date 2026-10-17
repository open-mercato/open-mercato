import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  DEAL_RESOURCE_KIND,
  DEAL_UPDATE_COMMAND_ID,
  createQaDeal,
  deleteQaDealIfExists,
  explainFieldOk,
  findChainEntry,
  listDealAuditActions,
  redoAuditAction,
  undoAuditAction,
  updateQaDeal,
  uniqueSuffix,
} from './helpers/explainApi'

/**
 * TC-INS-015: Undo and redo appear in the chain with causes linked to the source log
 * Covers:
 *   - PUT  /api/customers/deals (status)
 *   - POST /api/audit_logs/audit-logs/actions/undo and /redo
 *   - GET  /api/insights/explain?resourceKind=customers.deal&field=status
 *
 * After undo, the source change is shown as `undone` (pointing at the undo trace)
 * and the trace is caused by `undo` with the source log id. After redo, the source
 * is `redone` and the newest entry is caused by `redo` with the same source log id.
 * The chain stays consistent with the record, so the verdict stays `explained`.
 */
test.describe('TC-INS-015: explain undo and redo of a deal status change', () => {
  test('shows undone/redone states and links undo/redo causes to the source log', async ({ request }) => {
    let token: string | null = null
    let dealId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const suffix = uniqueSuffix()
      const targetStatus = `qa_target_${suffix}`
      dealId = await createQaDeal(request, token, { title: `QA INS-015 ${suffix}`, status: 'open' })
      await updateQaDeal(request, token, dealId, { status: targetStatus })
      const query = { resourceKind: DEAL_RESOURCE_KIND, resourceId: dealId, field: 'status' }

      const sourceLog = (await listDealAuditActions(request, token, dealId))
        .find((item) => item.commandId === DEAL_UPDATE_COMMAND_ID)
      expect(sourceLog?.undoToken, 'the status change exposes an undo token').toBeTruthy()
      const sourceLogId = sourceLog!.id

      await undoAuditAction(request, token, sourceLog!.undoToken!)
      const afterUndo = await explainFieldOk(request, token, query)
      expect(afterUndo.current.value, 'undo restored the previous status').toBe('open')
      expect(afterUndo.verdict).toBe('explained')

      const undoTrace = afterUndo.chain[0]
      expect(undoTrace.logId).not.toBe(sourceLogId)
      expect(undoTrace.state).toBe('done')
      expect(undoTrace.from?.value).toBe(targetStatus)
      expect(undoTrace.to?.value).toBe('open')
      expect(undoTrace.cause).toEqual(expect.objectContaining({ kind: 'undo', id: sourceLogId, available: true }))

      const undoneSource = findChainEntry(afterUndo, sourceLogId)
      expect(undoneSource.state).toBe('undone')
      expect(undoneSource.undoneBy, 'the undone change points at its undo trace').toBe(undoTrace.logId)
      expect(undoneSource.cause.kind, 'the source change keeps its own cause').toBe('user')

      const redoLogId = await redoAuditAction(request, token, sourceLogId)
      const afterRedo = await explainFieldOk(request, token, query)
      expect(afterRedo.current.value, 'redo re-applied the change').toBe(targetStatus)
      expect(afterRedo.verdict).toBe('explained')

      const redoEntry = afterRedo.chain[0]
      expect(redoEntry.logId).toBe(redoLogId)
      expect(redoEntry.from?.value).toBe('open')
      expect(redoEntry.to?.value).toBe(targetStatus)
      expect(redoEntry.cause).toEqual(expect.objectContaining({ kind: 'redo', id: sourceLogId, available: true }))

      expect(findChainEntry(afterRedo, sourceLogId).state, 'the source change is marked redone').toBe('redone')
      expect(findChainEntry(afterRedo, undoTrace.logId).cause).toEqual(
        expect.objectContaining({ kind: 'undo', id: sourceLogId, available: true }),
      )
    } finally {
      await deleteQaDealIfExists(request, token, dealId)
    }
  })
})
