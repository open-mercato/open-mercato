import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createPersonFixture, deleteEntityIfExists, readJsonSafe } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  expectOperation,
  undoOk,
  redoOk,
  runCrudUndoRoundTrip,
  skipIfUndoTestsDisabled,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-001 customers.comments (#2572).
 *
 * Comments are a relation entity referencing a parent person/company via `entityId`.
 * The test creates a self-contained parent person, then drives create→undo (I3/I5),
 * update→undo→redo (I1/I6), and delete→undo (I2) on its comments, reading each state back
 * through the comment list filtered by the parent. The parent is removed in teardown.
 */
test.describe('TC-UNDO-001 customers.comments undo/redo', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('comment CRUD commands restore scalar state on undo/redo', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let personId: string | null = null
    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'Undo',
        lastName: `CommentParent ${stamp}`,
        displayName: `Undo CommentParent ${stamp}`,
      })

      await runCrudUndoRoundTrip(request, token, {
        label: 'customers.comments',
        collectionPath: '/api/customers/comments',
        readPath: () => `/api/customers/comments?entityId=${encodeURIComponent(personId as string)}`,
        field: 'body',
        createPayload: (s) => ({
          entityId: personId,
          body: `Undo comment ${s}`,
        }),
        updatePayload: (id, s) => ({
          id,
          body: `Undo comment changed ${s}`,
        }),
      })
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
  test('body update, undo and redo preserve the original author despite supplied author changes', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let personId: string | null = null
    let commentId: string | null = null
    try {
      personId = await createPersonFixture(request, token, { firstName: 'Attribution', lastName: `${Date.now()}`, displayName: `Attribution ${Date.now()}` })
      const created = await apiRequest(request, 'POST', '/api/customers/comments', {
        token, data: { entityId: personId, body: 'Original attribution' },
      })
      expect(created.status()).toBe(201)
      const original = await readJsonSafe<{ id: string; authorUserId: string }>(created)
      expect(original?.authorUserId).toBeTruthy()
      commentId = original!.id
      const readComment = async () => {
        const response = await apiRequest(request, 'GET', `/api/customers/comments?entityId=${personId}`, { token })
        expect(response.ok()).toBeTruthy()
        const result = await readJsonSafe<{ items: Array<{ id: string; body: string; author_user_id: string }> }>(response)
        return result!.items.find(item => item.id === commentId)
      }
      for (const authorInput of [{ authorUserId: personId }, { authorUserId: null }, {}]) {
        const updated = await apiRequest(request, 'PUT', '/api/customers/comments', {
          token, data: { id: commentId, body: 'Edited attribution', ...authorInput },
        })
        expect(updated.ok()).toBeTruthy()
        const operation = expectOperation(updated, 'attribution update')
        expect(await readComment()).toMatchObject({ body: 'Edited attribution', author_user_id: original!.authorUserId })
        await undoOk(request, token, operation.undoToken, 'attribution update')
        expect(await readComment()).toMatchObject({ body: 'Original attribution', author_user_id: original!.authorUserId })
        await redoOk(request, token, operation.logId, 'attribution update')
        expect(await readComment()).toMatchObject({ body: 'Edited attribution', author_user_id: original!.authorUserId })
        await apiRequest(request, 'PUT', '/api/customers/comments', { token, data: { id: commentId, body: 'Original attribution' } })
      }
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/comments', commentId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

})
