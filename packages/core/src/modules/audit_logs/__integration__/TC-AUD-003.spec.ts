import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteEntityByPathIfExists } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createAuditableDictionaryEntry,
  findActionLog,
  undoAction,
} from './helpers/auditLogsApi'

/**
 * TC-AUD-003: Undo an action and verify execution-state transitions
 * Covers:
 *   - POST /api/audit_logs/audit-logs/actions/undo
 *   - GET  /api/audit_logs/audit-logs/actions
 *   - POST /api/dictionaries/{id}/entries
 *
 * A dictionary entry creation flows through the command bus and produces an
 * undoable action log. Undoing it must flip the log to `undone`, consume the
 * single-use token, and remove the underlying entry.
 */
test.describe('TC-AUD-003: Undo an action', () => {
  test('undoes a dictionary entry creation and transitions the log to "undone"', async ({ request }) => {
    let token: string | null = null
    let dictionaryId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')

      const created = await createAuditableDictionaryEntry(request, token, { keyPrefix: 'aud003' })
      dictionaryId = created.dictionaryId

      const log = await findActionLog(request, token, { resourceId: created.entryId })
      expect(log, 'action log for the created entry should exist').not.toBeNull()
      expect(log!.executionState, 'a newly created entry log starts in "done"').toBe('done')
      const undoToken = log!.undoToken
      expect(typeof undoToken === 'string' && undoToken.length > 0, 'log should expose an undo token').toBe(true)

      const undoResponse = await undoAction(request, token, undoToken!)
      expect(undoResponse.status(), 'undo should return 200').toBe(200)
      const undoBody = (await undoResponse.json()) as { ok?: boolean; logId?: string }
      expect(undoBody.ok, 'undo response reports ok=true').toBe(true)
      expect(undoBody.logId, 'undo response carries the undone log id').toBe(log!.id)

      const afterUndo = await findActionLog(request, token, { resourceId: created.entryId, logId: log!.id })
      expect(afterUndo, 'the original log is still resolvable after undo').not.toBeNull()
      expect(afterUndo!.executionState, 'executionState transitions from "done" to "undone"').toBe('undone')

      // The token is single-use: it is cleared on the log once consumed, so a
      // second undo with the same token can no longer resolve a target.
      const secondUndo = await undoAction(request, token, undoToken!)
      expect(secondUndo.status(), 'reusing a consumed undo token returns 400').toBe(400)
      const secondBody = (await secondUndo.json()) as { error?: string }
      expect(secondBody.error, 'reused token reports "Undo token not available"').toBe('Undo token not available')

      // An unknown / malformed token is rejected the same way.
      const bogusUndo = await undoAction(request, token, 'not-a-real-undo-token')
      expect(bogusUndo.status(), 'an unknown undo token returns 400').toBe(400)
    } finally {
      await deleteEntityByPathIfExists(
        request,
        token,
        dictionaryId ? `/api/dictionaries/${encodeURIComponent(dictionaryId)}` : null,
      )
    }
  })
})
