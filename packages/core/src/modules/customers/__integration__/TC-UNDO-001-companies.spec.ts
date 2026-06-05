import { test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  runCrudUndoRoundTrip,
  skipIfUndoTestsDisabled,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-001 customers.companies (#2572).
 *
 * Covers create→undo (I3/I5), update→undo→redo (I1/I6), and delete→undo (I2)
 * through the public API and real undo/redo endpoints.
 */
test.describe('TC-UNDO-001 customers.companies undo/redo', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('companies CRUD commands restore scalar state on undo/redo', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    await runCrudUndoRoundTrip(request, token, {
      label: 'customers.companies',
      collectionPath: '/api/customers/companies',
      readPath: (id) => `/api/customers/companies/${encodeURIComponent(id)}`,
      field: 'displayName',
      createPayload: (stamp) => ({
        displayName: `Undo Company ${stamp}`,
        primaryEmail: `company-${stamp}@example.com`,
      }),
      updatePayload: (id, stamp) => ({
        id,
        displayName: `Undo Company Renamed ${stamp}`,
        primaryEmail: `company-renamed-${stamp}@example.com`,
      }),
    })
  })
})
