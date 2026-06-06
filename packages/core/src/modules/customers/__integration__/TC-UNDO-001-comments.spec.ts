import { test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
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
})
