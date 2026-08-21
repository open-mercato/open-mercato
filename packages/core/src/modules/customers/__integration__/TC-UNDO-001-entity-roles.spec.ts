import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe, getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  expectOperation,
  undoOk,
  expectTokenConsumed,
  skipIfUndoTestsDisabled,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-001 customers.entityRoles (#2572).
 *
 * Entity-role assignments link a user to a person/company under a role type. Creating a role
 * then undoing must remove it (I3), and the consumed token is rejected on a second undo (I5).
 * The role's `userId` fixture is the calling admin's own user id. Self-contained: the parent
 * person is created via API and removed in teardown.
 */

async function rolesForPerson(
  request: APIRequestContext,
  token: string,
  personId: string,
): Promise<Array<{ id: string }>> {
  const res = await apiRequest(request, 'GET', `/api/customers/people/${encodeURIComponent(personId)}/roles`, { token })
  const body = (await readJsonSafe(res)) as { items?: Array<{ id: string }> } | null
  return body?.items ?? []
}

test.describe('TC-UNDO-001 customers.entityRoles undo', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('create role → undo removes it (I3) + token consumed (I5)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const userId = getTokenScope(token).userId
    let personId: string | null = null
    let roleId: string | null = null
    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'Undo',
        lastName: `RoleTarget ${stamp}`,
        displayName: `Undo RoleTarget ${stamp}`,
      })

      const createRes = await apiRequest(request, 'POST', `/api/customers/people/${personId}/roles`, {
        token,
        data: { roleType: `account_manager_${stamp}`, userId },
      })
      expect(createRes.status(), `role create status ${createRes.status()}`).toBe(201)
      const createOp = expectOperation(createRes, 'entityRoles.create')
      const createBody = (await readJsonSafe(createRes)) as { id?: string } | null
      roleId = createBody?.id ?? null
      expect(roleId, 'role id present').toBeTruthy()
      expect((await rolesForPerson(request, token, personId as string)).some((role) => role.id === roleId), 'role present after create').toBe(true)

      await undoOk(request, token, createOp.undoToken, 'undo entity-role create')
      expect((await rolesForPerson(request, token, personId as string)).some((role) => role.id === roleId), 'role removed on undo (I3)').toBe(false)

      await expectTokenConsumed(request, token, createOp.undoToken, 'entityRoles.create double-undo (I5)')
    } finally {
      if (personId && roleId) await apiRequest(request, 'DELETE', `/api/customers/people/${personId}/roles?roleId=${roleId}`, { token }).catch(() => {})
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
