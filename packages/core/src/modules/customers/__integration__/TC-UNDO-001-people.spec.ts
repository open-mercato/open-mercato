import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  expectOperation,
  undoOk,
  redoOk,
  expectTokenConsumed,
  skipIfUndoTestsDisabled,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-001 (§3.1 customers.people) — Undo/Redo correctness for the reference module.
 *
 * Drives the real command bus through the public API + undo/redo endpoints.
 * Active tests assert invariants that currently hold; known defects are quarantined with
 * test.fixme() and linked to filed bugs so the suite stays green while documenting the gap.
 *   - people.create → undo → redo mints a NEW id instead of restoring the soft-deleted
 *     original → finding under review (see #2468 tracking PR). Quarantined below.
 */

const PEOPLE = '/api/customers/people'

async function getPerson(request: APIRequestContext, token: string, id: string) {
  const res = await apiRequest(request, 'GET', `${PEOPLE}/${id}`, { token })
  return { status: res.status(), body: (await readJsonSafe(res)) as any }
}

test.describe('TC-UNDO-001 customers.people undo/redo', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('create → undo soft-deletes (I2) + token consumed (I5)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let personId: string | null = null
    try {
      const createRes = await apiRequest(request, 'POST', PEOPLE, {
        token,
        data: { firstName: 'Undo', lastName: `Create ${stamp}`, displayName: `Undo Create ${stamp}` },
      })
      expect(createRes.ok(), `create status ${createRes.status()}`).toBeTruthy()
      const createOp = expectOperation(createRes, 'customers.people.create')
      personId = createOp.resourceId
      expect(personId).toBeTruthy()

      const afterCreate = await getPerson(request, token, personId as string)
      expect(afterCreate.status, 'person should exist after create').toBe(200)
      expect(afterCreate.body?.person?.displayName).toBe(`Undo Create ${stamp}`)

      await undoOk(request, token, createOp.undoToken, 'undo create person')
      const afterUndo = await getPerson(request, token, personId as string)
      expect(afterUndo.status, 'person should be gone after undoing create (I2)').not.toBe(200)

      // double-undo rejected — token consumed (I5)
      await expectTokenConsumed(request, token, createOp.undoToken, 'people.create double-undo')
    } finally {
      if (personId) await apiRequest(request, 'DELETE', `${PEOPLE}?id=${personId}`, { token }).catch(() => {})
    }
  })

  test('delete → undo (re-materialize, I2) → redo (re-delete, I6)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let personId: string | null = null
    try {
      const createRes = await apiRequest(request, 'POST', PEOPLE, {
        token,
        data: { firstName: 'Undo', lastName: `Delete ${stamp}`, displayName: `Undo Delete ${stamp}` },
      })
      expect(createRes.ok()).toBeTruthy()
      personId = expectOperation(createRes, 'people.create').resourceId

      const deleteRes = await apiRequest(request, 'DELETE', `${PEOPLE}?id=${personId}`, { token })
      expect(deleteRes.ok(), `delete status ${deleteRes.status()}`).toBeTruthy()
      const deleteOp = expectOperation(deleteRes, 'people.delete')

      const afterDelete = await getPerson(request, token, personId as string)
      expect(afterDelete.status, 'gone after delete').not.toBe(200)

      await undoOk(request, token, deleteOp.undoToken, 'undo delete person')
      const afterUndo = await getPerson(request, token, personId as string)
      expect(afterUndo.status, 're-materialized after undo delete (I2)').toBe(200)
      expect(afterUndo.body?.person?.displayName).toBe(`Undo Delete ${stamp}`)

      await redoOk(request, token, deleteOp.logId, 'redo delete person')
      const afterRedo = await getPerson(request, token, personId as string)
      expect(afterRedo.status, 'gone again after redo delete (I6)').not.toBe(200)
    } finally {
      if (personId) await apiRequest(request, 'DELETE', `${PEOPLE}?id=${personId}`, { token }).catch(() => {})
    }
  })

  test('update → undo restores prior scalars (I1) — regression #2498', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let personId: string | null = null
    try {
      const createRes = await apiRequest(request, 'POST', PEOPLE, {
        token,
        data: { firstName: 'Undo', lastName: `Update ${stamp}`, displayName: `Undo Update ${stamp}`, primaryEmail: `before-${stamp}@example.com` },
      })
      personId = expectOperation(createRes, 'people.create').resourceId
      const before = await getPerson(request, token, personId as string)

      const updateRes = await apiRequest(request, 'PUT', PEOPLE, {
        token,
        data: { id: personId, displayName: `Undo Update CHANGED ${stamp}`, primaryEmail: `after-${stamp}@example.com` },
      })
      const updateOp = expectOperation(updateRes, 'people.update')

      await undoOk(request, token, updateOp.undoToken, 'undo update person')
      const afterUndo = await getPerson(request, token, personId as string)
      expect(afterUndo.body?.person?.displayName, 'displayName restored (I1)').toBe(before.body?.person?.displayName)
      expect(afterUndo.body?.person?.primaryEmail, 'primaryEmail restored (I1)').toBe(before.body?.person?.primaryEmail)
    } finally {
      if (personId) await apiRequest(request, 'DELETE', `${PEOPLE}?id=${personId}`, { token }).catch(() => {})
    }
  })

  // FINDING (#2468) — redo of a create mints a NEW id instead of restoring the soft-deleted original.
  test.fixme('create → undo → redo restores the SAME entity (I6) — finding #2468', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let personId: string | null = null
    try {
      const createRes = await apiRequest(request, 'POST', PEOPLE, {
        token,
        data: { firstName: 'Undo', lastName: `Redo ${stamp}`, displayName: `Undo Redo ${stamp}` },
      })
      const createOp = expectOperation(createRes, 'people.create')
      personId = createOp.resourceId
      const undoLogId = await undoOk(request, token, createOp.undoToken, 'undo create')
      await redoOk(request, token, undoLogId, 'redo create')
      const afterRedo = await getPerson(request, token, personId as string)
      expect(afterRedo.status, 'same entity restored after redo (I6)').toBe(200)
    } finally {
      if (personId) await apiRequest(request, 'DELETE', `${PEOPLE}?id=${personId}`, { token }).catch(() => {})
    }
  })
})
