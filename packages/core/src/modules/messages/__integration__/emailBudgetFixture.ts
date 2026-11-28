import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { deleteGeneralEntityIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export async function createEmailBudgetFixture(request: APIRequestContext) {
  const ownerToken = await getAuthToken(request, 'superadmin')
  const stamp = randomUUID()
  const password = `Budget-${randomUUID()}!`
  const email = `qa-email-budget-${stamp}@example.test`
  const roleName = `qa-email-budget-${stamp}`
  let tenantId: string | null = null
  let organizationId: string | null = null
  let roleId: string | null = null
  let userId: string | null = null

  const cleanup = async () => {
    if (tenantId) {
      await withClient(async (client) => {
        await client.query('delete from message_external_email_windows where tenant_id = $1', [tenantId])
        await client.query('delete from message_external_recipient_days where tenant_id = $1', [tenantId])
        await client.query("delete from module_configs where tenant_id = $1 and module_id = 'messages' and name = 'externalEmailDailyRecipientLimit'", [tenantId])
        const remaining = await client.query<{ count: number }>(
          `select ((select count(*) from message_external_email_windows where tenant_id = $1)
            + (select count(*) from message_external_recipient_days where tenant_id = $1))::int as count`,
          [tenantId],
        )
        expect(remaining.rows).toEqual([{ count: 0 }])
      })
    }
    await deleteUserIfExists(request, ownerToken, userId)
    await deleteRoleIfExists(request, ownerToken, roleId)
    await deleteOrganizationIfExists(request, ownerToken, organizationId)
    await deleteGeneralEntityIfExists(request, ownerToken, '/api/directory/tenants', tenantId)
  }

  try {
    const response = await apiRequest(request, 'POST', '/api/directory/tenants', {
      token: ownerToken,
      data: { name: `QA email budget ${stamp}` },
    })
    expect(response.status()).toBe(201)
    tenantId = expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'Email budget tenant')
    organizationId = await createOrganizationFixture(request, ownerToken, { name: `QA email budget ${stamp}`, tenantId })
    roleId = await createRoleFixture(request, ownerToken, { name: roleName, tenantId })
    await setRoleAclFeatures(request, ownerToken, {
      roleId,
      features: ['messages.*', 'communication_channels.*', 'customers.*', 'configs.*'],
      organizations: [organizationId],
    })
    userId = await createUserFixture(request, ownerToken, { email, password, organizationId, roles: [roleName] })
    const token = await getAuthToken(request, email, password)
    return { token, tenantId, userId, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}
