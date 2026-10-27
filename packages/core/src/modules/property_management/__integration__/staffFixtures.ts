import type { APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'

export type ManagerFixture = { roleId: string; users: Array<{ id: string; email: string; token: string }> }

export const MANAGER_PASSWORD = 'StrongSecret123!'

export async function createManagers(
  request: APIRequestContext,
  adminToken: string,
  stamp: string,
  count: number,
  extraFeatures: string[] = [],
): Promise<ManagerFixture> {
  const { tenantId, organizationId } = getTokenContext(adminToken)
  const roleId = await createRoleFixture(request, adminToken, { name: `qa-pm-manager-${stamp}`, tenantId })
  await setRoleAclFeatures(request, adminToken, {
    roleId,
    features: ['property_management.view', 'property_management.manage', ...extraFeatures],
  })
  const users: ManagerFixture['users'] = []
  for (let index = 0; index < count; index += 1) {
    const email = `qa-pm-manager-${index}-${stamp}@example.com`
    const id = await createUserFixture(request, adminToken, {
      email,
      password: MANAGER_PASSWORD,
      organizationId,
      roles: [roleId],
      name: `QA PM Manager ${index} ${stamp}`,
    })
    const token = await getAuthToken(request, email, MANAGER_PASSWORD)
    users.push({ id, email, token })
  }
  return { roleId, users }
}

export async function deleteManagers(request: APIRequestContext, adminToken: string | null, fixture: ManagerFixture | null): Promise<void> {
  if (!adminToken || !fixture) return
  for (const user of fixture.users) await deleteUserIfExists(request, adminToken, user.id)
  await deleteRoleIfExists(request, adminToken, fixture.roleId)
}
