import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteEntityByPathIfExists, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createAuditableDictionaryEntry,
  findActionLog,
  redoAction,
  undoAction,
} from './helpers/auditLogsApi'

/**
 * TC-AUD-004: Redo a previously undone action and verify state restoration
 * Covers:
 *   - POST /api/audit_logs/audit-logs/actions/undo
 *   - POST /api/audit_logs/audit-logs/actions/redo
 *   - GET  /api/audit_logs/audit-logs/actions
 *   - POST /api/dictionaries/{id}/entries
 *
 * Redo replays the command (the command bus stores a `__redoInput` envelope for
 * every command), re-applies the domain change, marks the source log `redone`,
 * and issues a brand-new log + undo token.
 */
test.describe('TC-AUD-004: Redo a previously undone action', () => {
  test('redoes an undone entry creation, restoring domain state with a fresh undo token', async ({ request }) => {
    let token: string | null = null
    let dictionaryId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')

      const created = await createAuditableDictionaryEntry(request, token, { keyPrefix: 'aud004' })
      dictionaryId = created.dictionaryId

      const originalLog = await findActionLog(request, token, { resourceId: created.entryId })
      expect(originalLog, 'action log for the created entry should exist').not.toBeNull()
      const originalUndoToken = originalLog!.undoToken
      expect(typeof originalUndoToken === 'string' && originalUndoToken.length > 0, 'log exposes an undo token').toBe(true)

      const undoResponse = await undoAction(request, token, originalUndoToken!)
      expect(undoResponse.status(), 'undo should return 200').toBe(200)

      const undone = await findActionLog(request, token, { resourceId: created.entryId, logId: originalLog!.id })
      expect(undone!.executionState, 'log is "undone" before redo').toBe('undone')

      const redoResponse = await redoAction(request, token, originalLog!.id)
      expect(redoResponse.status(), 'redo should return 200').toBe(200)
      const redoBody = (await redoResponse.json()) as { ok?: boolean; logId?: string | null; undoToken?: string | null }
      expect(redoBody.ok, 'redo response reports ok=true').toBe(true)
      expect(typeof redoBody.logId === 'string' && redoBody.logId.length > 0, 'redo issues a new log id').toBe(true)
      expect(redoBody.logId, 'the redo log is a new entry, not the source log').not.toBe(originalLog!.id)
      const freshUndoToken = redoBody.undoToken
      expect(typeof freshUndoToken === 'string' && freshUndoToken.length > 0, 'redo issues a non-null undo token').toBe(true)
      expect(freshUndoToken, 'the redo undo token differs from the original').not.toBe(originalUndoToken)

      // Source log flips to "redone".
      const redoneSource = await findActionLog(request, token, { resourceId: created.entryId, logId: originalLog!.id })
      expect(redoneSource!.executionState, 'the source log transitions to "redone"').toBe('redone')

      // The domain change is re-applied: the dictionary now holds a freshly
      // re-created entry (a new id, since the original was removed by the undo).
      const entriesResponse = await apiRequest(
        request,
        'GET',
        `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries`,
        { token },
      )
      expect(entriesResponse.status(), 'entries list should return 200').toBe(200)
      const entriesBody = await readJsonSafe<{ items?: Array<{ id?: string }> }>(entriesResponse)
      const recreatedEntryId = entriesBody?.items?.[0]?.id
      expect(typeof recreatedEntryId === 'string' && recreatedEntryId.length > 0, 'a re-created entry exists').toBe(true)
      expect(recreatedEntryId, 'the re-created entry has a new id').not.toBe(created.entryId)

      // The new log row is "done" and carries the fresh undo token.
      const newLog = await findActionLog(request, token, { resourceId: recreatedEntryId!, logId: redoBody.logId! })
      expect(newLog, 'the new redo log row should be resolvable').not.toBeNull()
      expect(newLog!.executionState, 'the new log row is "done"').toBe('done')
      expect(newLog!.undoToken, 'the new log carries the fresh undo token').toBe(freshUndoToken)

      // Redo on a log that is already "done" is rejected.
      const redoAgain = await redoAction(request, token, redoBody.logId!)
      expect(redoAgain.status(), 'redoing an already-done log returns 400').toBe(400)
      const redoAgainBody = (await redoAgain.json()) as { error?: string }
      expect(redoAgainBody.error, 'reports "Redo target not available"').toBe('Redo target not available')

      // The fresh undo token is functional for a subsequent undo.
      const undoAgain = await undoAction(request, token, freshUndoToken!)
      expect(undoAgain.status(), 'the fresh undo token can be undone again').toBe(200)
    } finally {
      await deleteEntityByPathIfExists(
        request,
        token,
        dictionaryId ? `/api/dictionaries/${encodeURIComponent(dictionaryId)}` : null,
      )
    }
  })
})
