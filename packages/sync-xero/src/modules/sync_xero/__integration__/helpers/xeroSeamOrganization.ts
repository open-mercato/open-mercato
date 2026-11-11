import type { APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createOrganizationInDb,
  deleteIntegrationCredentialsInDb,
  deleteOrganizationInDb,
  deleteUserAclInDb,
} from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { isXeroTestFakesAvailable, resetXeroFakes } from './xeroTestFakes'

export const XERO_SEAM_ORGANIZATION_FEATURES = ['integrations.view', 'integrations.manage', 'integrations.credentials.manage']

export type XeroSeamOrganization = {
  organizationId: string
  roleId: string | null
  userId: string | null
  token: string | null
}

/**
 * Creates a throwaway organization in the admin's tenant and a user whose home organization it
 * is, so a spec can write Xero credentials without touching an organization it did not create.
 * Returns `null`, after a read-only probe and before creating anything, when
 * OM_ENABLE_TEST_OAUTH_GRANTS is off in the app under test; `test.skip` the spec on `null`.
 */
export async function openXeroSeamOrganization(
  request: APIRequestContext,
  adminToken: string,
  label: string,
  extraFeatures: string[] = [],
): Promise<(XeroSeamOrganization & { token: string }) | null> {
  if (!(await isXeroTestFakesAvailable(request, adminToken))) return null
  const { tenantId } = getTokenScope(adminToken)
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const email = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${stamp}@example.com`
  const password = 'Secret123!'
  const organization: XeroSeamOrganization = {
    organizationId: await createOrganizationInDb({ name: `${label} ${stamp}`, tenantId }),
    roleId: null,
    userId: null,
    token: null,
  }
  try {
    organization.roleId = await createRoleFixture(request, adminToken, { name: `${label} ${stamp}` })
    organization.userId = await createUserFixture(request, adminToken, {
      email,
      password,
      organizationId: organization.organizationId,
      roles: [organization.roleId],
    })
    await setUserAclVisibility(request, adminToken, {
      userId: organization.userId,
      features: [...XERO_SEAM_ORGANIZATION_FEATURES, ...extraFeatures],
      organizations: [organization.organizationId],
    })
    const token = await getAuthToken(request, email, password)
    organization.token = token
    return { ...organization, token }
  } catch (error) {
    await closeXeroSeamOrganization(request, adminToken, organization)
    throw error
  }
}

/**
 * Removes only what {@link openXeroSeamOrganization} created: the seam's rows, the user, the role,
 * and the throwaway organization with its credential rows. Does nothing for `null`.
 */
export async function closeXeroSeamOrganization(
  request: APIRequestContext,
  adminToken: string,
  organization: XeroSeamOrganization | null,
): Promise<void> {
  if (!organization) return
  if (organization.token) await resetXeroFakes(request, organization.token).catch(() => undefined)
  await deleteUserIfExists(request, adminToken, organization.userId)
  if (organization.userId) await deleteUserAclInDb(organization.userId).catch(() => undefined)
  await deleteRoleIfExists(request, adminToken, organization.roleId)
  await deleteIntegrationCredentialsInDb(organization.organizationId).catch(() => undefined)
  await deleteOrganizationInDb(organization.organizationId).catch(() => undefined)
}
