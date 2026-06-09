import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCustomerCompanyFixture,
  createCustomerRoleFixture,
  createCustomerUserFixture,
  deleteCustomerCompanyFixture,
  deleteCustomerRoleFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
  type PortalSession,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'

/**
 * TC-PORTAL-005 [P1]: Portal user roles PUT atomically replaces the role set and
 * only accepts `customerAssignable` roles.
 *
 * Surface: PUT /api/customer_accounts/portal/users/[id]/roles
 * Source: issue #2463.
 *
 * Verified contract:
 *   - non-assignable role / unknown valid-UUID role → 400 'Role not found or not assignable'
 *   - assignable role → 200 { ok:true }, replacing (not appending) the role set
 *   - empty roleIds → 400 'Validation failed' (schema requires >= 1)
 *   - missing portal.users.roles.manage → 403 'Insufficient permissions'
 */

type OkResponse = { ok: boolean; error?: string }
type PortalUser = { id: string; roles: Array<{ id: string; slug: string }> }
type UsersListResponse = { ok: boolean; users?: PortalUser[] }

const JSON_HEADER = { 'Content-Type': 'application/json' }

async function findUserRoles(
  request: APIRequestContext,
  session: PortalSession,
  userId: string,
): Promise<Array<{ id: string; slug: string }> | null> {
  const res = await request.get('/api/customer_accounts/portal/users?pageSize=100', {
    headers: portalCookieHeaders(session),
  })
  const body = await readJsonSafe<UsersListResponse>(res)
  const found = (body?.users ?? []).find((u) => u.id === userId)
  return found ? found.roles : null
}

test.describe('TC-PORTAL-005: portal user role assignment', () => {
  test('replaces roles atomically and enforces customerAssignable', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)

    let company: string | null = null
    const roleIds: string[] = []
    const userIds: string[] = []

    try {
      company = await createCustomerCompanyFixture(request, adminToken)
      // Caller can both manage roles and view the company roster (for read-back).
      const callerRole = await createCustomerRoleFixture(request, adminToken, {
        features: ['portal.users.roles.manage', 'portal.users.view'],
      })
      roleIds.push(callerRole.id)
      const assignableA = await createCustomerRoleFixture(request, adminToken, { customerAssignable: true })
      roleIds.push(assignableA.id)
      const assignableB = await createCustomerRoleFixture(request, adminToken, { customerAssignable: true })
      roleIds.push(assignableB.id)
      const nonAssignable = await createCustomerRoleFixture(request, adminToken, { customerAssignable: false })
      roleIds.push(nonAssignable.id)

      const caller = await createCustomerUserFixture(request, adminToken, {
        roleIds: [callerRole.id],
        customerEntityId: company,
      })
      userIds.push(caller.id)
      // Target starts with assignableA (admin-create bypasses the assignable gate).
      const target = await createCustomerUserFixture(request, adminToken, {
        roleIds: [assignableA.id],
        customerEntityId: company,
      })
      userIds.push(target.id)

      const adminSession = await portalLogin(request, {
        email: caller.email,
        password: caller.password,
        tenantId,
      })

      const targetRolesUrl = `/api/customer_accounts/portal/users/${target.id}/roles`

      // Non-assignable role is rejected.
      const nonAssignRes = await request.put(targetRolesUrl, {
        data: { roleIds: [nonAssignable.id] },
        headers: portalCookieHeaders(adminSession, JSON_HEADER),
      })
      expect(nonAssignRes.status(), 'non-assignable role should be 400').toBe(400)
      expect((await readJsonSafe<OkResponse>(nonAssignRes))?.error).toBe('Role not found or not assignable')

      // Unknown but well-formed role id is rejected the same way.
      const unknownRes = await request.put(targetRolesUrl, {
        data: { roleIds: [randomUUID()] },
        headers: portalCookieHeaders(adminSession, JSON_HEADER),
      })
      expect(unknownRes.status(), 'unknown role id should be 400').toBe(400)
      expect((await readJsonSafe<OkResponse>(unknownRes))?.error).toBe('Role not found or not assignable')

      // Valid assignable role replaces the existing set (A → B, not A+B).
      const okRes = await request.put(targetRolesUrl, {
        data: { roleIds: [assignableB.id] },
        headers: portalCookieHeaders(adminSession, JSON_HEADER),
      })
      expect(okRes.status(), 'assignable role should be 200').toBe(200)
      expect((await readJsonSafe<OkResponse>(okRes))?.ok).toBe(true)

      const rolesAfter = await findUserRoles(request, adminSession, target.id)
      expect(rolesAfter, 'target should be visible in the company roster').toBeTruthy()
      expect(rolesAfter!.length, 'role set replaced, not appended').toBe(1)
      expect(rolesAfter![0].id).toBe(assignableB.id)
      expect(rolesAfter!.some((r) => r.id === assignableA.id), 'previous role removed').toBe(false)
    } finally {
      for (const id of userIds) await deleteCustomerUserFixture(request, adminToken, id)
      for (const id of roleIds) await deleteCustomerRoleFixture(request, adminToken, id)
      await deleteCustomerCompanyFixture(request, adminToken, company)
    }
  })

  test('rejects an empty role set and unauthorized callers', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId } = getTokenContext(adminToken)

    let company: string | null = null
    const roleIds: string[] = []
    const userIds: string[] = []

    try {
      company = await createCustomerCompanyFixture(request, adminToken)
      const callerRole = await createCustomerRoleFixture(request, adminToken, {
        features: ['portal.users.roles.manage'],
      })
      roleIds.push(callerRole.id)
      const plainRole = await createCustomerRoleFixture(request, adminToken, {
        features: ['portal.account.manage'],
      })
      roleIds.push(plainRole.id)

      const manager = await createCustomerUserFixture(request, adminToken, {
        roleIds: [callerRole.id],
        customerEntityId: company,
      })
      userIds.push(manager.id)
      const target = await createCustomerUserFixture(request, adminToken, {
        customerEntityId: company,
      })
      userIds.push(target.id)
      const plain = await createCustomerUserFixture(request, adminToken, {
        roleIds: [plainRole.id],
        customerEntityId: company,
      })
      userIds.push(plain.id)

      const managerSession = await portalLogin(request, {
        email: manager.email,
        password: manager.password,
        tenantId,
      })
      const plainSession = await portalLogin(request, {
        email: plain.email,
        password: plain.password,
        tenantId,
      })

      // Empty roleIds fails validation (schema requires at least one).
      const emptyRes = await request.put(`/api/customer_accounts/portal/users/${target.id}/roles`, {
        data: { roleIds: [] },
        headers: portalCookieHeaders(managerSession, JSON_HEADER),
      })
      expect(emptyRes.status(), 'empty roleIds should be 400').toBe(400)
      expect((await readJsonSafe<OkResponse>(emptyRes))?.error).toBe('Validation failed')

      // Caller without portal.users.roles.manage is rejected.
      const deniedRes = await request.put(`/api/customer_accounts/portal/users/${target.id}/roles`, {
        data: { roleIds: [callerRole.id] },
        headers: portalCookieHeaders(plainSession, JSON_HEADER),
      })
      expect(deniedRes.status(), 'caller without feature should be 403').toBe(403)
      expect((await readJsonSafe<OkResponse>(deniedRes))?.error).toBe('Insufficient permissions')
    } finally {
      for (const id of userIds) await deleteCustomerUserFixture(request, adminToken, id)
      for (const id of roleIds) await deleteCustomerRoleFixture(request, adminToken, id)
      await deleteCustomerCompanyFixture(request, adminToken, company)
    }
  })
})
