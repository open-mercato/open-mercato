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
import { withClient, type IntegrationDbClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { deleteGeneralEntityIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const SENDER_FEATURES = ['messages.*', 'communication_channels.*', 'customers.*', 'configs.*', 'attachments.view']
const DAILY_LIMIT_CONFIG = 'externalEmailDailyRecipientLimit'

async function clearLedger(client: IntegrationDbClient, tenantId: string) {
  await client.query('delete from message_external_email_windows where tenant_id = $1', [tenantId])
  await client.query('delete from message_external_recipient_days where tenant_id = $1', [tenantId])
}

export async function readEmailBudgetLedger(tenantId: string) {
  return withClient(async (client) => {
    const recipients = await client.query<{ recipient_hash: string }>(
      'select recipient_hash from message_external_recipient_days where tenant_id = $1 order by utc_day, recipient_hash',
      [tenantId],
    )
    const windows = await client.query<{ scope: string; subject_id: string; count: number }>(
      `select scope, subject_id, count from message_external_email_windows
       where tenant_id = $1 order by scope, subject_id, window_start`,
      [tenantId],
    )
    return { recipients: recipients.rows, windows: windows.rows }
  })
}

export async function deleteEmailBudgetSystemChannel(
  request: APIRequestContext,
  token: string,
  channelId: string | null,
) {
  if (!channelId) return
  const response = await apiRequest(request, 'DELETE', `/api/communication_channels/admin/channels/${channelId}`, { token })
  expect(response.ok(), 'Delete the fixture system email channel').toBe(true)
}

export async function createEmailBudgetFixture(request: APIRequestContext, loginRequest = request) {
  const ownerToken = await getAuthToken(request, 'superadmin')
  const stamp = randomUUID()
  const organizationIds: string[] = []
  const roleIds: string[] = []
  const userIds: string[] = []

  const response = await apiRequest(request, 'POST', '/api/directory/tenants', {
    token: ownerToken,
    data: { name: `QA email budget ${stamp}` },
  })
  expect(response.status()).toBe(201)
  const tenantId = expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'Email budget tenant')

  const createOrganization = async () => {
    const organizationId = await createOrganizationFixture(request, ownerToken, {
      name: `QA email budget ${stamp} ${organizationIds.length + 1}`,
      tenantId,
    })
    organizationIds.push(organizationId)
    return organizationId
  }

  const createActor = async (organizationId: string, features = SENDER_FEATURES, authRequest = request) => {
    const actorStamp = randomUUID()
    const roleName = `qa-email-budget-${actorStamp}`
    const email = `${roleName}@example.test`
    const password = `Budget-${randomUUID()}!`
    const roleId = await createRoleFixture(request, ownerToken, { name: roleName, tenantId })
    roleIds.push(roleId)
    await setRoleAclFeatures(request, ownerToken, { roleId, features, organizations: [organizationId] })
    const userId = await createUserFixture(request, ownerToken, { email, password, organizationId, roles: [roleName] })
    userIds.push(userId)
    const token = await getAuthToken(authRequest, email, password)
    return { token, userId }
  }

  const setDailyLimit = async (limit: number) => {
    await withClient(async (client) => {
      await client.query(
        `insert into module_configs (id, module_id, name, value_json, tenant_id, organization_id, created_at, updated_at)
         values ($1, 'messages', $2, to_jsonb($3::int), $4, null, now(), now())`,
        [stamp, DAILY_LIMIT_CONFIG, limit, tenantId],
      )
    })
  }

  const cleanup = async () => {
    try {
      await withClient(async (client) => {
        await client.query('begin')
        try {
          await clearLedger(client, tenantId)
          await client.query(
            'delete from integration_credentials where tenant_id = $1 and organization_id = any($2::uuid[])',
            [tenantId, organizationIds],
          )
          await client.query(
            `delete from module_configs where id = $1 and tenant_id = $2 and module_id = 'messages'
             and name = $3 and organization_id is null`,
            [stamp, tenantId, DAILY_LIMIT_CONFIG],
          )
          await client.query('commit')
        } catch (error) {
          await client.query('rollback')
          throw error
        }
      })
      expect(await readEmailBudgetLedger(tenantId)).toEqual({ recipients: [], windows: [] })
    } finally {
      for (const userId of userIds) await deleteUserIfExists(request, ownerToken, userId)
      for (const roleId of roleIds) await deleteRoleIfExists(request, ownerToken, roleId)
      for (const organizationId of organizationIds) await deleteOrganizationIfExists(request, ownerToken, organizationId)
      await deleteGeneralEntityIfExists(request, ownerToken, '/api/directory/tenants', tenantId)
    }
  }

  try {
    const organizationId = await createOrganization()
    const actor = await createActor(organizationId, SENDER_FEATURES, loginRequest)
    return {
      ...actor,
      tenantId,
      organizationId,
      createActor,
      createOrganization,
      setDailyLimit,
      clearLedger: () => withClient((client) => clearLedger(client, tenantId)),
      cleanup,
    }
  } catch (error) {
    await cleanup()
    throw error
  }
}
