import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'

test('staff changes preserve the current target grant ceiling', async ({ request }) => {
  const superadmin = await getAuthToken(request, 'superadmin')
  const { organizationId, tenantId } = getTokenContext(superadmin)
  const suffix = randomUUID()
  const password = `Grant!9-${suffix}`
  const roles: string[] = []
  const users: string[] = []
  const permitted = 'customers.people.view'
  const privileged = 'sales.orders.view'
  const operatorEmail = `grant-operator-${suffix}@example.test`

  const createRole = async (kind: string, features: string[]) => {
    const roleId = await createRoleFixture(request, superadmin, { name: `qa-grant-${kind}-${suffix}`, tenantId })
    roles.push(roleId)
    await setRoleAclFeatures(request, superadmin, { roleId, features, organizations: [organizationId] })
    return roleId
  }
  const createUser = async (email: string, role: string) => {
    const userId = await createUserFixture(request, superadmin, {
      email, password, organizationId, roles: [role],
    })
    users.push(userId)
    return userId
  }

  try {
    const operatorRole = await createRole('operator', [
      'auth.users.list', 'auth.users.edit', 'auth.users.delete', 'auth.acl.manage', permitted,
    ])
    const basicRole = await createRole('basic', [permitted])
    const protectedRole = await createRole('protected', [privileged])
    await createUser(operatorEmail, operatorRole)
    const protectedUser = await createUser(`grant-protected-${suffix}@example.test`, protectedRole)
    const directGrantUser = await createUser(`grant-direct-${suffix}@example.test`, basicRole)
    const operator = await getAuthToken(request, operatorEmail, password)

    const initialAcl = await apiRequest(request, 'PUT', '/api/auth/users/acl', {
      token: superadmin,
      data: { userId: directGrantUser, features: [privileged], organizations: [organizationId] },
    })
    expect(initialAcl.status()).toBe(200)

    const deniedUpdate = await apiRequest(request, 'PUT', '/api/auth/users', {
      token: operator,
      data: { id: protectedUser, email: `grant-rename-${suffix}@example.test` },
    })
    expect(deniedUpdate.status()).toBe(403)
    const deniedDelete = await apiRequest(request, 'DELETE', `/api/auth/users?id=${protectedUser}`, { token: operator })
    expect(deniedDelete.status()).toBe(403)

    const deniedRoleAcl = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
      token: operator,
      data: { roleId: protectedRole, features: [permitted], organizations: [organizationId] },
    })
    expect(deniedRoleAcl.status()).toBe(403)
    const deniedUserAcl = await apiRequest(request, 'PUT', '/api/auth/users/acl', {
      token: operator,
      data: { userId: directGrantUser, features: [permitted], organizations: [organizationId] },
    })
    expect(deniedUserAcl.status()).toBe(403)

    await setRoleAclFeatures(request, superadmin, {
      roleId: protectedRole, features: [permitted], organizations: [organizationId],
    })
    const allowedUpdate = await apiRequest(request, 'PUT', '/api/auth/users', {
      token: operator,
      data: { id: protectedUser, email: `grant-allowed-${suffix}@example.test` },
    })
    expect(allowedUpdate.status()).toBe(200)
    const allowedRoleAcl = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
      token: operator,
      data: { roleId: basicRole, features: [], organizations: [organizationId] },
    })
    expect(allowedRoleAcl.status()).toBe(200)
  } finally {
    for (const user of users.reverse()) await deleteUserIfExists(request, superadmin, user)
    for (const role of roles.reverse()) await deleteRoleIfExists(request, superadmin, role)
  }
})
