import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
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
  DICTIONARY_ENTRY_RESOURCE_KIND,
  findActionLog,
  listActionLogs,
  redoAction,
  undoAction,
} from './helpers/auditLogsApi'

const CONCURRENT_REDOS = 6
const UPDATE_COMMAND_ID = 'dictionaries.entries.update'

/**
 * TC-AUD-014: concurrent redo requests for one undone action replay it once
 * Covers:
 *   - POST /api/audit_logs/audit-logs/actions/redo
 *   - POST /api/audit_logs/audit-logs/actions/undo
 *   - GET  /api/audit_logs/audit-logs/actions
 *
 * Dictionary entry updates replay through the default (non-atomic) redo path.
 * Several redo requests fired at once for the same undone log must claim the
 * source log atomically: exactly one replays the command and records a new
 * action log, every other request is rejected and records nothing. A
 * dedicated self-scoped user owns the action so parallel specs undoing as
 * superadmin cannot change which log is the latest undone one.
 */
test.describe('TC-AUD-014: concurrent redo claims the source log once', () => {
  test('only one of several concurrent redo requests replays the command', async ({ request }) => {
    const stamp = Date.now()
    const password = 'Aud014!Pass1'
    const email = `qa-aud-redo-race-${stamp}@acme.com`
    let superToken: string | null = null
    let token: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
    let dictionaryId: string | null = null

    try {
      superToken = await getAuthToken(request, 'superadmin')
      const scope = getTokenScope(superToken)
      roleId = await createRoleFixture(request, superToken, { name: `qa_aud_redo_race_${stamp}`, tenantId: scope.tenantId })
      await setRoleAclFeatures(request, superToken, {
        roleId,
        features: [
          'dictionaries.view',
          'dictionaries.manage',
          'audit_logs.view_self',
          'audit_logs.undo_self',
          'audit_logs.redo_self',
        ],
        organizations: null,
      })
      userId = await createUserFixture(request, superToken, {
        email,
        password,
        organizationId: scope.organizationId,
        roles: [roleId],
      })
      token = await getAuthToken(request, email, password)
      const created = await createAuditableDictionaryEntry(request, token, { keyPrefix: 'aud014' })
      dictionaryId = created.dictionaryId
      const entryPath = `/api/dictionaries/${encodeURIComponent(created.dictionaryId)}/entries/${encodeURIComponent(created.entryId)}`

      const redoneLabel = `Redone ${stamp}`
      const update = await apiRequest(request, 'PATCH', entryPath, { token, data: { label: redoneLabel } })
      expect(update.status(), 'the entry update succeeds').toBe(200)

      const { body: afterUpdate } = await listActionLogs(request, token, {
        resourceKind: DICTIONARY_ENTRY_RESOURCE_KIND,
        resourceId: created.entryId,
      })
      const updateLog = (afterUpdate?.items ?? []).find((item) => item.commandId === UPDATE_COMMAND_ID)
      expect(updateLog, 'the update writes an undoable action log').toBeTruthy()
      expect(typeof updateLog!.undoToken === 'string' && updateLog!.undoToken.length > 0).toBe(true)

      const undo = await undoAction(request, token, updateLog!.undoToken!)
      expect(undo.status(), 'the update can be undone').toBe(200)

      const { body: beforeRedo } = await listActionLogs(request, token, {
        resourceKind: DICTIONARY_ENTRY_RESOURCE_KIND,
        resourceId: created.entryId,
      })
      const logIdsBeforeRedo = new Set((beforeRedo?.items ?? []).map((item) => item.id))

      const responses = await Promise.all(
        Array.from({ length: CONCURRENT_REDOS }, () => redoAction(request, token!, updateLog!.id)),
      )
      const statuses = responses.map((response) => response.status())
      expect(statuses.filter((status) => status === 200), 'exactly one concurrent redo succeeds').toHaveLength(1)
      expect(statuses.filter((status) => status === 400), 'every other concurrent redo is rejected').toHaveLength(CONCURRENT_REDOS - 1)

      const { body: afterRedo } = await listActionLogs(request, token, {
        resourceKind: DICTIONARY_ENTRY_RESOURCE_KIND,
        resourceId: created.entryId,
      })
      const newLogs = (afterRedo?.items ?? []).filter((item) => !logIdsBeforeRedo.has(item.id))
      expect(newLogs, 'the concurrent redos record exactly one new action log').toHaveLength(1)
      expect(newLogs[0].commandId).toBe(UPDATE_COMMAND_ID)

      const source = await findActionLog(request, token, { resourceId: created.entryId, logId: updateLog!.id })
      expect(source?.executionState, 'the source log ends up redone').toBe('redone')

      const entries = await apiRequest(request, 'GET', `/api/dictionaries/${encodeURIComponent(created.dictionaryId)}/entries`, { token })
      expect(entries.status()).toBe(200)
      const entriesBody = (await entries.json()) as { items?: Array<{ id: string; label: string }> }
      const entry = (entriesBody.items ?? []).find((item) => item.id === created.entryId)
      expect(entry?.label, 'the redo re-applied the update').toBe(redoneLabel)
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
