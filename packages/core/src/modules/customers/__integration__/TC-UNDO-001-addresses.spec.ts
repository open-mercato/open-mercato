import { test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  runCrudUndoRoundTrip,
  skipIfUndoTestsDisabled,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-001 customers.addresses (#2572).
 *
 * Addresses are a relation entity that must link to a parent person/company via `entityId`.
 * The test creates a self-contained parent person, then drives create→undo (I3/I5),
 * update→undo→redo (I1/I6), and delete→undo (I2) on its addresses, reading each state back
 * through the address list filtered by the parent. The parent is removed in teardown.
 */
test.describe('TC-UNDO-001 customers.addresses undo/redo', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('address CRUD commands restore scalar state on undo/redo', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let personId: string | null = null
    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'Undo',
        lastName: `AddrParent ${stamp}`,
        displayName: `Undo AddrParent ${stamp}`,
      })

      await runCrudUndoRoundTrip(request, token, {
        label: 'customers.addresses',
        collectionPath: '/api/customers/addresses',
        readPath: () => `/api/customers/addresses?entityId=${encodeURIComponent(personId as string)}`,
        // The address list serializes snake_case columns; create/update payloads accept camelCase.
        field: 'address_line1',
        createPayload: (s) => ({
          entityId: personId,
          addressLine1: `Undo Street ${s}`,
        }),
        updatePayload: (id, s) => ({
          id,
          addressLine1: `Undo Street Changed ${s}`,
        }),
      })
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
