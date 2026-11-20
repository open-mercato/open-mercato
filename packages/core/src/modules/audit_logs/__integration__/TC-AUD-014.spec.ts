import { expect, test, type APIRequestContext } from '@playwright/test'
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

const CONCURRENT_REQUESTS = 6
const UPDATE_COMMAND_ID = 'dictionaries.entries.update'

type Fixtures = {
  superToken: string | null
  roleId: string | null
  userId: string | null
  dictionaryId: string | null
}

type EntryUpdate = {
  token: string
  entryId: string
  entryPath: string
  updateLogId: string
  undoToken: string
  redoneLabel: string
}

function emptyFixtures(): Fixtures {
  return { superToken: null, roleId: null, userId: null, dictionaryId: null }
}

async function createEntryUpdate(
  request: APIRequestContext,
  fixtures: Fixtures,
  stamp: string,
): Promise<EntryUpdate> {
  const password = 'Aud014!Pass1'
  const email = `qa-aud-redo-race-${stamp}@acme.com`
  const superToken = await getAuthToken(request, 'superadmin')
  fixtures.superToken = superToken
  const scope = getTokenScope(superToken)
  const roleId = await createRoleFixture(request, superToken, { name: `qa_aud_redo_race_${stamp}`, tenantId: scope.tenantId })
  fixtures.roleId = roleId
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
  fixtures.userId = await createUserFixture(request, superToken, {
    email,
    password,
    organizationId: scope.organizationId,
    roles: [roleId],
  })
  const token = await getAuthToken(request, email, password)
  const created = await createAuditableDictionaryEntry(request, token, { keyPrefix: 'aud014' })
  fixtures.dictionaryId = created.dictionaryId
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

  return {
    token,
    entryId: created.entryId,
    entryPath,
    updateLogId: updateLog!.id,
    undoToken: updateLog!.undoToken!,
    redoneLabel,
  }
}

async function createUndoneEntryUpdate(
  request: APIRequestContext,
  fixtures: Fixtures,
  stamp: string,
): Promise<EntryUpdate> {
  const update = await createEntryUpdate(request, fixtures, stamp)
  const undo = await undoAction(request, update.token, update.undoToken)
  expect(undo.status(), 'the update can be undone').toBe(200)
  return update
}

async function listEntryLogIds(request: APIRequestContext, token: string, entryId: string): Promise<Set<string>> {
  const { body } = await listActionLogs(request, token, {
    resourceKind: DICTIONARY_ENTRY_RESOURCE_KIND,
    resourceId: entryId,
  })
  return new Set((body?.items ?? []).map((item) => item.id))
}

async function cleanupFixtures(request: APIRequestContext, fixtures: Fixtures) {
  await deleteEntityByPathIfExists(
    request,
    fixtures.superToken,
    fixtures.dictionaryId ? `/api/dictionaries/${encodeURIComponent(fixtures.dictionaryId)}` : null,
  )
  await deleteUserIfExists(request, fixtures.superToken, fixtures.userId)
  await deleteRoleIfExists(request, fixtures.superToken, fixtures.roleId)
}

/**
 * TC-AUD-014: concurrent redo requests for one undone action replay it once
 * Covers:
 *   - POST /api/audit_logs/audit-logs/actions/redo
 *   - POST /api/audit_logs/audit-logs/actions/undo
 *   - GET  /api/audit_logs/audit-logs/actions
 *   - PATCH/DELETE /api/dictionaries/:dictionaryId/entries/:entryId
 *   - GET  /api/dictionaries/:dictionaryId/entries
 *
 * Dictionary entry updates replay through the default (non-atomic) redo path.
 * Several redo requests fired at once for the same undone log must claim the
 * source log atomically: exactly one replays the command and records a new
 * action log, every other request is rejected and records nothing. Concurrent
 * undos of one token likewise undo once, and a request that loses the undo
 * claim must not release the winner's claim. A redo whose command fails must
 * release its claim so the log stays redoable. A
 * dedicated self-scoped user owns the action so parallel specs undoing as
 * superadmin cannot change which log is the latest undone one.
 */
test.describe('TC-AUD-014: concurrent redo claims the source log once', () => {
  test('only one of several concurrent redo requests replays the command', async ({ request }) => {
    const fixtures = emptyFixtures()

    try {
      const { token, entryId, updateLogId, redoneLabel } = await createUndoneEntryUpdate(request, fixtures, `${Date.now()}a`)

      const logIdsBeforeRedo = await listEntryLogIds(request, token, entryId)

      const responses = await Promise.all(
        Array.from({ length: CONCURRENT_REQUESTS }, () => redoAction(request, token, updateLogId)),
      )
      const statuses = responses.map((response) => response.status())
      expect(statuses.filter((status) => status === 200), 'exactly one concurrent redo succeeds').toHaveLength(1)
      expect(statuses.filter((status) => status === 400), 'every other concurrent redo is rejected').toHaveLength(CONCURRENT_REQUESTS - 1)

      const { body: afterRedo } = await listActionLogs(request, token, {
        resourceKind: DICTIONARY_ENTRY_RESOURCE_KIND,
        resourceId: entryId,
      })
      const newLogs = (afterRedo?.items ?? []).filter((item) => !logIdsBeforeRedo.has(item.id))
      expect(newLogs, 'the concurrent redos record exactly one new action log').toHaveLength(1)
      expect(newLogs[0].commandId).toBe(UPDATE_COMMAND_ID)

      const source = await findActionLog(request, token, { resourceId: entryId, logId: updateLogId })
      expect(source?.executionState, 'the source log ends up redone').toBe('redone')

      const entries = await apiRequest(request, 'GET', `/api/dictionaries/${encodeURIComponent(fixtures.dictionaryId!)}/entries`, { token })
      expect(entries.status()).toBe(200)
      const entriesBody = (await entries.json()) as { items?: Array<{ id: string; label: string }> }
      const entry = (entriesBody.items ?? []).find((item) => item.id === entryId)
      expect(entry?.label, 'the redo re-applied the update').toBe(redoneLabel)
    } finally {
      await cleanupFixtures(request, fixtures)
    }
  })

  test('only one of several concurrent undo requests undoes the command', async ({ request }) => {
    const fixtures = emptyFixtures()

    try {
      const { token, entryId, updateLogId, undoToken } = await createEntryUpdate(request, fixtures, `${Date.now()}c`)
      const logIdsBeforeUndo = await listEntryLogIds(request, token, entryId)

      const responses = await Promise.all(
        Array.from({ length: CONCURRENT_REQUESTS }, () => undoAction(request, token, undoToken)),
      )
      const statuses = responses.map((response) => response.status())
      expect(statuses.filter((status) => status === 200), 'exactly one concurrent undo succeeds').toHaveLength(1)

      const logIdsAfterUndo = await listEntryLogIds(request, token, entryId)
      const newLogIds = [...logIdsAfterUndo].filter((id) => !logIdsBeforeUndo.has(id))
      expect(newLogIds, 'the concurrent undos record exactly one undo trace').toHaveLength(1)

      const source = await findActionLog(request, token, { resourceId: entryId, logId: updateLogId })
      expect(source?.executionState, 'the source log ends up undone').toBe('undone')
    } finally {
      await cleanupFixtures(request, fixtures)
    }
  })

  test('a redo whose command fails releases its claim and stays redoable', async ({ request }) => {
    const fixtures = emptyFixtures()

    try {
      const { token, entryId, entryPath, updateLogId } = await createUndoneEntryUpdate(request, fixtures, `${Date.now()}b`)

      const removed = await apiRequest(request, 'DELETE', entryPath, { token: fixtures.superToken! })
      expect(removed.status(), 'the entry is deleted so the replayed update fails').toBe(200)

      const failedRedo = await redoAction(request, token, updateLogId)
      expect(failedRedo.status(), 'the replayed update fails on the missing entry').toBe(404)

      const source = await findActionLog(request, token, { resourceId: entryId, logId: updateLogId })
      expect(source?.executionState, 'the failed redo releases its claim').toBe('undone')

      const retriedRedo = await redoAction(request, token, updateLogId)
      expect(retriedRedo.status(), 'the released log is still accepted for redo').toBe(404)
    } finally {
      await cleanupFixtures(request, fixtures)
    }
  })
})
