import type { APIRequestContext } from '@playwright/test'
import { expect } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  getAuthToken,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'

export const MS365_INTEGRATION_ID = 'channel_ms365'
/** Meets the default password policy (length, upper/lower case, digit, symbol). */
const PASSWORD = 'Tc-Ms365-Fixture-1!'

/**
 * Isolated tenant-config sandbox for the Microsoft 365 provider specs.
 *
 * Tenant OAuth client credentials are stored per organization, so every spec
 * that needs them gets its own organization plus a user (with the integration
 * and connect features) scoped to it. Nothing in the shared default
 * organization is touched, and the sandbox is torn down in `dispose()`.
 */
export interface Ms365Sandbox {
  token: string
  organizationId: string
  saveClientCredentials: (credentials: Record<string, string>) => Promise<void>
  dispose: () => Promise<void>
}

export async function createMs365Sandbox(request: APIRequestContext, label: string): Promise<Ms365Sandbox> {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`
  const adminToken = await getAuthToken(request, 'admin')
  const { tenantId } = getTokenContext(adminToken)

  let organizationId: string | null = null
  let roleId: string | null = null
  let userId: string | null = null
  const dispose = async () => {
    await deleteUserIfExists(request, adminToken, userId)
    await deleteRoleIfExists(request, adminToken, roleId)
    await deleteOrganizationIfExists(request, adminToken, organizationId)
  }

  try {
    organizationId = await createOrganizationFixture(request, adminToken, { name: `${label} ${stamp}`, tenantId })
    roleId = await createRoleFixture(request, adminToken, { name: `${label} role ${stamp}`, tenantId })
    await setRoleAclFeatures(request, adminToken, {
      roleId,
      features: [
        'integrations.view',
        'integrations.manage',
        'integrations.credentials.manage',
        'communication_channels.view',
        'communication_channels.connect_user_channel',
      ],
    })
    const email = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${stamp}@example.com`
    userId = await createUserFixture(request, adminToken, {
      email,
      password: PASSWORD,
      organizationId,
      roles: [roleId],
      name: `${label} user`,
    })
    const token = await getAuthToken(request, email, PASSWORD)
    expect(getTokenContext(token).organizationId, 'sandbox user is scoped to the sandbox organization').toBe(organizationId)

    const saveClientCredentials = async (credentials: Record<string, string>) => {
      const response = await apiRequest(request, 'PUT', `/api/integrations/${MS365_INTEGRATION_ID}/credentials`, {
        token,
        data: { credentials },
      })
      expect(response.status(), 'PUT sandbox credentials should succeed').toBe(200)
    }

    return {
      token,
      organizationId,
      saveClientCredentials,
      dispose: async () => {
        // Clear the sandbox row before removing the organization so no
        // credential material outlives the fixture.
        await saveClientCredentials({ clientId: '', clientSecret: '', tenantId: '', scopes: '' }).catch(() => undefined)
        await dispose()
      },
    }
  } catch (error) {
    await dispose()
    throw error
  }
}
