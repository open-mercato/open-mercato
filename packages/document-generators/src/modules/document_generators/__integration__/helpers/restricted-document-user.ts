import type { APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { DOCUMENTS_GENERATE_FEATURE, DOCUMENTS_VIEW_FEATURE } from './document-generators-api'

export type RestrictedDocumentUser = {
  token: string
  email: string
  cleanup: () => Promise<void>
}

export async function createRestrictedDocumentUser(
  request: APIRequestContext,
  input: { label: string; sourceFeatures?: string[] },
): Promise<RestrictedDocumentUser> {
  const superadminToken = await getAuthToken(request, 'superadmin')
  const { tenantId, organizationId } = getTokenContext(superadminToken)
  const adminToken = await getAuthToken(request, 'admin')
  const adminOrganizationId = getTokenContext(adminToken).organizationId || organizationId
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const email = `qa-doc-${input.label}-${stamp}@example.test`
  const password = 'Valid1!Pass'
  let roleId: string | null = null
  let userId: string | null = null
  const cleanup = async () => {
    await deleteUserIfExists(request, superadminToken, userId)
    await deleteRoleIfExists(request, superadminToken, roleId)
  }
  try {
    roleId = await createRoleFixture(request, superadminToken, { name: `qa-doc-${input.label}-${stamp}`, tenantId })
    await setRoleAclFeatures(request, superadminToken, {
      roleId,
      features: [DOCUMENTS_VIEW_FEATURE, DOCUMENTS_GENERATE_FEATURE, ...(input.sourceFeatures ?? [])],
      organizations: null,
    })
    userId = await createUserFixture(request, superadminToken, {
      email,
      password,
      organizationId: adminOrganizationId,
      roles: [roleId],
      name: `QA Document ${input.label}`,
    })
    const token = await getAuthToken(request, email, password)
    return { token, email, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}
