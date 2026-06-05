import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteEntityByPathIfExists, getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createAuditableDictionaryEntry,
  findActionLog,
  redoAction,
  undoAction,
} from './helpers/auditLogsApi'

/**
 * TC-AUD-006: undo/redo scoping guards deny cross-actor mutations
 * Covers:
 *   - POST /api/audit_logs/audit-logs/actions/undo
 *   - POST /api/audit_logs/audit-logs/actions/redo
 *   - GET  /api/audit_logs/audit-logs/actions
 *
 * A user holding only the `*_self` undo/redo features (no `*_tenant`) reaches
 * the route handlers but must NOT be able to undo or redo another actor's
 * action. The cross-actor guard returns 400 and leaves the target log unchanged.
 */
test.describe('TC-AUD-006: undo/redo scoping guards', () => {
  test('a self-only user cannot undo or redo another actor\'s action', async ({ request }) => {
    const stamp = Date.now()
    const password = 'Aud006!Pass1'
    const email = `qa-aud-selfonly-${stamp}@acme.com`
    const roleName = `qa_aud_selfonly_${stamp}`

    let superToken: string | null = null
    let attackerToken: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
    let dictionaryId: string | null = null

    try {
      superToken = await getAuthToken(request, 'superadmin')
      const scope = getTokenScope(superToken)

      // A user with the *_self undo/redo features but NOT the *_tenant ones.
      roleId = await createRoleFixture(request, superToken, { name: roleName, tenantId: scope.tenantId })
      await setRoleAclFeatures(request, superToken, {
        roleId,
        features: ['audit_logs.view_self', 'audit_logs.undo_self', 'audit_logs.redo_self'],
        organizations: null,
      })
      userId = await createUserFixture(request, superToken, {
        email,
        password,
        organizationId: scope.organizationId,
        roles: [roleId],
      })
      attackerToken = await getAuthToken(request, email, password)

      // The owner authors an undoable action.
      const created = await createAuditableDictionaryEntry(request, superToken, { keyPrefix: 'aud006' })
      dictionaryId = created.dictionaryId
      const ownerLog = await findActionLog(request, superToken, { resourceId: created.entryId })
      expect(ownerLog, "the owner's action log should exist").not.toBeNull()
      const ownerUndoToken = ownerLog!.undoToken
      expect(typeof ownerUndoToken === 'string' && ownerUndoToken.length > 0, 'owner log exposes an undo token').toBe(true)

      // Cross-actor UNDO is denied while the log is still "done".
      const crossUndo = await undoAction(request, attackerToken, ownerUndoToken!)
      expect(crossUndo.status(), 'cross-actor undo is rejected with 400').toBe(400)
      const crossUndoBody = (await crossUndo.json()) as { error?: string }
      expect(crossUndoBody.error, 'cross-actor undo reports "Undo token not available"').toBe('Undo token not available')

      // The failed undo left the log untouched.
      const stillDone = await findActionLog(request, superToken, { resourceId: created.entryId, logId: ownerLog!.id })
      expect(stillDone!.executionState, 'a denied undo does not change the log state').toBe('done')

      // The owner undoes successfully so the log becomes redo-eligible.
      const ownerUndo = await undoAction(request, superToken, ownerUndoToken!)
      expect(ownerUndo.status(), 'the owner can undo their own action').toBe(200)
      const undone = await findActionLog(request, superToken, { resourceId: created.entryId, logId: ownerLog!.id })
      expect(undone!.executionState, 'owner undo flips the log to "undone"').toBe('undone')

      // Cross-actor REDO of the now-undone log is denied.
      const crossRedo = await redoAction(request, attackerToken, ownerLog!.id)
      expect(crossRedo.status(), 'cross-actor redo is rejected with 400').toBe(400)
      const crossRedoBody = (await crossRedo.json()) as { error?: string }
      expect(crossRedoBody.error, 'cross-actor redo reports "Redo target not available"').toBe('Redo target not available')

      // The failed redo left the log untouched.
      const stillUndone = await findActionLog(request, superToken, { resourceId: created.entryId, logId: ownerLog!.id })
      expect(stillUndone!.executionState, 'a denied redo does not change the log state').toBe('undone')
    } finally {
      await deleteEntityByPathIfExists(
        request,
        superToken,
        dictionaryId ? `/api/dictionaries/${encodeURIComponent(dictionaryId)}` : null,
      )
      await deleteUserIfExists(request, superToken, userId)
      await deleteRoleIfExists(request, superToken, roleId)
    }
  })
})
