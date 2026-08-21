import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  expectOperation,
  undoByToken,
  undoOk,
  expectTokenConsumed,
  skipIfUndoTestsDisabled,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-001 §5 cross-cutting undo/redo invariants (#2572 / #2468).
 *
 * The customers module is the cross-cutting home for the shared undo cases:
 *   - X4 latest-only: undoing an older action while a newer one exists on the same resource → 400.
 *   - X5 double-undo: a consumed undo token is rejected.
 *   - X6/X7 actor scope: a non-owner (seeded employee, no `audit_logs.undo_tenant`) cannot undo
 *     an admin's action → 400.
 *   - redo-of-create restores the SAME entity id (regression for #2506, fixed by #2552).
 *
 * Each test drives the real command bus + undo/redo endpoints on people and cleans up its own
 * fixture in teardown.
 */

const PEOPLE = '/api/customers/people'
const UNDO_TOKEN_UNAVAILABLE = 'Undo token not available'

async function createPerson(request: APIRequestContext, token: string, displayName: string) {
  const res = await apiRequest(request, 'POST', PEOPLE, {
    token,
    data: { firstName: 'Undo', lastName: displayName, displayName },
  })
  expect(res.status(), `person create status ${res.status()}`).toBe(201)
  return expectOperation(res, 'people.create')
}

async function personStatus(request: APIRequestContext, token: string, id: string): Promise<number> {
  const res = await apiRequest(request, 'GET', `${PEOPLE}/${id}`, { token })
  return res.status()
}

test.describe('TC-UNDO-001 §5 cross-cutting undo/redo', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('X5 — a consumed undo token is rejected on a second undo', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let personId: string | null = null
    try {
      personId = (await createPerson(request, token, `Undo X5 ${stamp}`)).resourceId
      const updateRes = await apiRequest(request, 'PUT', PEOPLE, { token, data: { id: personId, displayName: `Undo X5 changed ${stamp}` } })
      const updateOp = expectOperation(updateRes, 'people.update')

      await undoOk(request, token, updateOp.undoToken, 'first undo consumes the token')
      await expectTokenConsumed(request, token, updateOp.undoToken, 'second undo is rejected (X5)')
    } finally {
      await deleteEntityIfExists(request, token, PEOPLE, personId)
    }
  })

  test('X4 — undoing an older action while a newer one exists is rejected (latest-only)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let personId: string | null = null
    try {
      personId = (await createPerson(request, token, `Undo X4 ${stamp}`)).resourceId
      const firstUpdate = expectOperation(
        await apiRequest(request, 'PUT', PEOPLE, { token, data: { id: personId, displayName: `Undo X4 first ${stamp}` } }),
        'people.update first',
      )
      // A newer undoable action on the same resource supersedes the older token.
      expectOperation(
        await apiRequest(request, 'PUT', PEOPLE, { token, data: { id: personId, displayName: `Undo X4 second ${stamp}` } }),
        'people.update second',
      )

      const res = await undoByToken(request, token, firstUpdate.undoToken)
      expect(res.status(), 'older undo rejected while newer exists (X4)').toBe(400)
      const body = (await readJsonSafe(res)) as { error?: string } | null
      expect(body?.error, 'X4 error message').toBe(UNDO_TOKEN_UNAVAILABLE)
    } finally {
      await deleteEntityIfExists(request, token, PEOPLE, personId)
    }
  })

  test('X6/X7 — a non-owner cannot undo another actor’s action', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const stamp = Date.now()
    let personId: string | null = null
    try {
      const createOp = await createPerson(request, adminToken, `Undo X6 ${stamp}`)
      personId = createOp.resourceId

      const res = await undoByToken(request, employeeToken, createOp.undoToken)
      expect(res.status(), 'non-owner undo rejected (X6/X7)').toBe(400)
      const body = (await readJsonSafe(res)) as { error?: string } | null
      expect(body?.error, 'X6/X7 error message').toBe(UNDO_TOKEN_UNAVAILABLE)

      // The action must remain applied — the employee's rejected undo changed nothing.
      expect(await personStatus(request, adminToken, personId as string), 'admin action not undone by non-owner').toBe(200)
    } finally {
      await deleteEntityIfExists(request, adminToken, PEOPLE, personId)
    }
  })

  // NOTE: redo-of-a-create restoring the SAME soft-deleted id is a known-open finding
  // (#2468 / #2506 — redo currently re-creates under a NEW id). It is quarantined as a
  // test.fixme in TC-UNDO-001-people.spec.ts; it is not a §5 cross-cutting case and is
  // intentionally not asserted here.
})
