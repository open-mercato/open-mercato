import type { APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * Features that open the document_generators endpoints themselves. A subject
 * holding these passes the route guards, so anything it is still refused comes
 * from the per-template requirements Sales declares — which is what the template
 * access specs are about.
 */
export const DOCUMENT_GENERATOR_FEATURES = [
  'document_generators.documents.view',
  'document_generators.documents.generate',
]

/**
 * Runs `use` as a freshly created user holding exactly `features`, then removes
 * the user and role. Each call mints its own email so specs never contend for
 * the same login (the login endpoint rate-limits per address).
 */
export async function withRestrictedDocumentUser(
  request: APIRequestContext,
  options: { label: string; features?: string[] },
  use: (token: string) => Promise<void>,
): Promise<void> {
  const adminToken = await getAuthToken(request, 'admin')
  const scope = getTokenScope(adminToken)
  const stamp = Date.now()
  const email = `qa-${options.label}-${stamp}@acme.com`
  const password = `QaDocs1!${stamp}`
  let roleId: string | null = null
  let userId: string | null = null

  try {
    roleId = await createRoleFixture(request, adminToken, {
      name: `QA ${options.label} ${stamp}`,
      tenantId: scope.tenantId || undefined,
    })
    await setRoleAclFeatures(request, adminToken, {
      roleId,
      features: options.features ?? DOCUMENT_GENERATOR_FEATURES,
    })
    userId = await createUserFixture(request, adminToken, {
      email,
      password,
      organizationId: scope.organizationId,
      roles: [roleId],
      name: `QA ${options.label} ${stamp}`,
    })

    await use(await getAuthToken(request, email, password))
  } finally {
    await deleteUserIfExists(request, adminToken, userId)
    await deleteRoleIfExists(request, adminToken, roleId)
  }
}
