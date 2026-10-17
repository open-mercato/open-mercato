import { randomInt } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  deleteEntityByPathIfExists,
  getTokenScope,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createAuditableDictionaryEntry,
  listEntryActionLogs,
  patchDictionaryEntry,
  readCausationFrames,
  redoAction,
  undoAction,
} from './helpers/auditLogsApi'

/**
 * TC-AUD-011: Undo and redo rows record their own cause
 * Covers:
 *   - PATCH /api/dictionaries/{id}/entries/{entryId}
 *   - POST  /api/audit_logs/audit-logs/actions/undo
 *   - POST  /api/audit_logs/audit-logs/actions/redo
 *   - GET   /api/audit_logs/audit-logs/actions
 *
 * The undo trace row is attributed to `undo` and the redo row to `redo`, both with
 * `causeId` = the source log id. The trace row never inherits the source row's
 * causation, while the actor stays the user who requested the undo/redo.
 */
test.describe('TC-AUD-011: undo and redo causation', () => {
  test('records the undo trace as "undo" and the replay as "redo" pointing at the source log', async ({ request }) => {
    let token: string | null = null
    let dictionaryId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const { userId } = getTokenScope(token)
      const unique = `${Date.now()}_${randomInt(1_000_000)}`
      const created = await createAuditableDictionaryEntry(request, token, { keyPrefix: 'aud011' })
      dictionaryId = created.dictionaryId

      const patchResult = await patchDictionaryEntry(request, token, {
        dictionaryId,
        entryId: created.entryId,
        data: { label: `Updated ${unique}` },
      })
      expect(patchResult.status, `entry update should succeed: ${patchResult.text}`).toBe(200)

      const beforeUndo = await listEntryActionLogs(request, token, created.entryId)
      const sourceLog = beforeUndo.find((item) => item.commandId === 'dictionaries.entries.update')
      expect(sourceLog, 'the update is audited').toBeTruthy()
      expect(sourceLog!.causeKind, 'the source update is a user write').toBe('user')
      const undoToken = sourceLog!.undoToken
      expect(typeof undoToken === 'string' && undoToken.length > 0, 'the update exposes an undo token').toBe(true)

      const undoResponse = await undoAction(request, token, undoToken!)
      expect(undoResponse.status(), 'undo should return 200').toBe(200)

      const afterUndo = await listEntryActionLogs(request, token, created.entryId)
      const traceRow = afterUndo[0]
      expect(traceRow.id, 'the newest row is the undo trace, not the source').not.toBe(sourceLog!.id)
      expect(traceRow.causeKind, 'the trace row is attributed to undo').toBe('undo')
      expect(traceRow.causeId, 'the trace row points at the undone source log').toBe(sourceLog!.id)
      expect(traceRow.actorUserId, 'the undo requester stays the actor').toBe(userId)
      expect(traceRow.context?.historyAction, 'the trace keeps its history marker').toBe('undo')
      expect(traceRow.context?.sourceLogId, 'the trace keeps its source pointer').toBe(sourceLog!.id)
      expect(readCausationFrames(traceRow).at(-1), 'the innermost frame is the undo').toEqual(
        expect.objectContaining({ kind: 'undo', id: sourceLog!.id }),
      )
      expect(traceRow.correlationId, 'the undo request has its own correlation').not.toBe(sourceLog!.correlationId)

      const redoResponse = await redoAction(request, token, sourceLog!.id)
      expect(redoResponse.status(), 'redo should return 200').toBe(200)
      const redoBody = (await redoResponse.json()) as { ok?: boolean; logId?: string | null }
      expect(typeof redoBody.logId === 'string' && redoBody.logId.length > 0, 'redo issues a new log').toBe(true)

      const afterRedo = await listEntryActionLogs(request, token, created.entryId)
      const redoRow = afterRedo.find((item) => item.id === redoBody.logId)
      expect(redoRow, 'the redo row is listed for the entry').toBeTruthy()
      expect(redoRow!.causeKind, 'the replay is attributed to redo').toBe('redo')
      expect(redoRow!.causeId, 'the redo row points at the source log').toBe(sourceLog!.id)
      expect(redoRow!.actorUserId, 'the redo requester stays the actor').toBe(userId)
      expect(readCausationFrames(redoRow!).at(-1), 'the innermost frame is the redo').toEqual(
        expect.objectContaining({ kind: 'redo', id: sourceLog!.id }),
      )
    } finally {
      await deleteEntityByPathIfExists(
        request,
        token,
        dictionaryId ? `/api/dictionaries/${encodeURIComponent(dictionaryId)}` : null,
      )
    }
  })
})
