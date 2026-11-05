import { test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  runCrudUndoRoundTrip,
  skipIfUndoTestsDisabled,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-001 customers.deals (#2572).
 *
 * Drives the real command bus + undo/redo endpoints across create→undo (I3/I5),
 * update→undo→redo (I1/I6), and delete→undo (I2) for the deal aggregate. Deals are a
 * standalone root entity (no parent fixture required); the round trip reads each state
 * back through the deal detail endpoint.
 */
test.describe('TC-UNDO-001 customers.deals undo/redo', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('deals CRUD commands restore scalar state on undo/redo', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    await runCrudUndoRoundTrip(request, token, {
      label: 'customers.deals',
      collectionPath: '/api/customers/deals',
      readPath: (id) => `/api/customers/deals/${encodeURIComponent(id)}`,
      field: 'title',
      createPayload: (stamp) => ({
        title: `Undo Deal ${stamp}`,
      }),
      updatePayload: (id, stamp) => ({
        id,
        title: `Undo Deal Renamed ${stamp}`,
      }),
    })
  })
})
