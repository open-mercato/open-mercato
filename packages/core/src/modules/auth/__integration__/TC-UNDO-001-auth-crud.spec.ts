import { test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  runCrudUndoRoundTrip,
  skipIfUndoTestsDisabled,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-001 auth (#2573).
 *
 * Covers the two primary undoable auth CRUD surfaces: roles and users.
 */
test.describe('TC-UNDO-001 auth undo/redo', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('roles CRUD commands restore scalar state on undo/redo', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(token)

    await runCrudUndoRoundTrip(request, token, {
      label: 'auth.roles',
      collectionPath: '/api/auth/roles',
      field: 'name',
      createPayload: (stamp) => ({
        name: `Undo Role ${stamp}`,
        tenantId,
      }),
      updatePayload: (id, stamp) => ({
        id,
        name: `Undo Role Renamed ${stamp}`,
        tenantId,
      }),
    })
  })

  test('users CRUD commands restore scalar state on undo/redo', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(token)

    await runCrudUndoRoundTrip(request, token, {
      label: 'auth.users',
      collectionPath: '/api/auth/users',
      field: 'name',
      createPayload: (stamp) => ({
        email: `undo-user-${stamp}@example.com`,
        name: `Undo User ${stamp}`,
        password: 'Secret123!',
        organizationId,
      }),
      updatePayload: (id, stamp) => ({
        id,
        name: `Undo User Renamed ${stamp}`,
        organizationId,
      }),
    })
  })
})
