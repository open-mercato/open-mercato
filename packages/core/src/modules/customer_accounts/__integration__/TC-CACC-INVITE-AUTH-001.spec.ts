import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createCustomerCompanyFixture,
  createCustomerRoleFixture,
  customerTestPassword,
  deleteCustomerCompanyFixture,
  deleteCustomerRoleFixture,
  deleteCustomerUserFixture,
  uniqueSuffix,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { deleteUserAclInDb, setUserAclInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { hashToken } from '@open-mercato/core/modules/customer_accounts/lib/tokenGenerator'

test.describe('TC-CACC-INVITE-AUTH-001: invitation authorization (#2252)', () => {
  test('an invite-only staff user cannot invite restricted roles or link an out-of-scope company', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(adminToken)
    expectId(tenantId, 'Admin tenant')
    expectId(organizationId, 'Admin organization')
    const suffix = uniqueSuffix()
    const email = `qa-invite-staff-${suffix}@test.local`
    const password = customerTestPassword()
    let staffUserId: string | null = null
    let deniedUserId: string | null = null
    let restrictedRoleId: string | null = null
    let assignableRoleId: string | null = null
    let companyId: string | null = null

    try {
      staffUserId = await createUserFixture(request, adminToken, { email, password, organizationId, roles: [] })
      await setUserAclInDb({ userId: staffUserId, tenantId, features: ['customer_accounts.invite'], organizations: [organizationId] })
      const staffToken = await getAuthToken(request, email, password)
      restrictedRoleId = (await createCustomerRoleFixture(request, adminToken, { customerAssignable: false })).id
      assignableRoleId = (await createCustomerRoleFixture(request, adminToken, { customerAssignable: true })).id
      companyId = await createCustomerCompanyFixture(request, adminToken)

      const invite = (roleIds: string[], customerEntityId?: string, token = staffToken) => apiRequest(
        request, 'POST', '/api/customer_accounts/admin/users-invite', {
          token,
          data: { email: `qa-invite-target-${uniqueSuffix()}@test.local`, roleIds, customerEntityId },
        },
      )
      expect((await invite([restrictedRoleId])).status(), 'Nonassignable role must be rejected').toBe(400)
      expect((await invite([assignableRoleId, randomUUID()])).status(), 'Missing role must reject the whole invitation').toBe(400)

      await withClient(async (client) => {
        await client.query('update customer_roles set organization_id = $2 where id = $1', [assignableRoleId, randomUUID()])
      })
      expect((await invite([assignableRoleId])).status(), 'Role from another organization must be rejected').toBe(400)
      await withClient(async (client) => {
        await client.query('update customer_roles set organization_id = $2 where id = $1', [assignableRoleId, organizationId])
        await client.query('update customer_entities set organization_id = $2 where id = $1', [companyId, randomUUID()])
      })
      expect((await invite([assignableRoleId], companyId)).status(), 'Company from another organization must be rejected').toBe(400)

      const deniedEmail = `qa-no-invite-${suffix}@test.local`
      deniedUserId = await createUserFixture(request, adminToken, { email: deniedEmail, password, organizationId, roles: [] })
      await setUserAclInDb({ userId: deniedUserId, tenantId, features: [], organizations: [organizationId] })
      const deniedToken = await getAuthToken(request, deniedEmail, password)
      expect((await invite([assignableRoleId], undefined, deniedToken)).status(), 'Invite permission is required').toBe(403)

      const pending = await withClient(async (client) => client.query<{ count: string }>(
        'select count(*)::text as count from customer_user_invitations where invited_by_user_id = $1', [staffUserId],
      ))
      expect(pending.rows[0].count, 'Rejected invites must leave no pending invitations').toBe('0')
    } finally {
      await withClient(async (client) => {
        if (assignableRoleId) await client.query('update customer_roles set organization_id = $2 where id = $1', [assignableRoleId, organizationId])
        if (companyId) await client.query('update customer_entities set organization_id = $2 where id = $1', [companyId, organizationId])
        if (staffUserId) await client.query('delete from customer_user_invitations where invited_by_user_id = $1', [staffUserId])
      })
      await deleteCustomerCompanyFixture(request, adminToken, companyId)
      await deleteCustomerRoleFixture(request, adminToken, assignableRoleId)
      await deleteCustomerRoleFixture(request, adminToken, restrictedRoleId)
      if (staffUserId) await deleteUserAclInDb(staffUserId)
      await deleteUserIfExists(request, adminToken, staffUserId)
      if (deniedUserId) await deleteUserAclInDb(deniedUserId)
      await deleteUserIfExists(request, adminToken, deniedUserId)
    }
  })

  test('accepting an older invitation grants only roles that are still customer assignable', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(adminToken)
    expectId(tenantId, 'Admin tenant')
    expectId(organizationId, 'Admin organization')
    const email = `qa-invite-accept-${uniqueSuffix()}@test.local`
    const token = randomUUID()
    const invitationId = randomUUID()
    let assignableRoleId: string | null = null
    let restrictedRoleId: string | null = null
    let userId: string | null = null

    try {
      assignableRoleId = (await createCustomerRoleFixture(request, adminToken, { customerAssignable: true })).id
      restrictedRoleId = (await createCustomerRoleFixture(request, adminToken, { customerAssignable: false })).id
      await withClient(async (client) => {
        await client.query(
          `insert into customer_user_invitations
           (id, tenant_id, organization_id, email, email_hash, token, role_ids_json, expires_at, created_at)
           values ($1, $2, $3, $4, $5, $6, $7::jsonb, now() + interval '1 hour', now())`,
          [invitationId, tenantId, organizationId, email, randomUUID(), hashToken(token), JSON.stringify([assignableRoleId, restrictedRoleId])],
        )
      })
      const response = await request.post('/api/customer_accounts/invitations/accept', {
        data: { token, password: customerTestPassword(), displayName: 'Invitation authorization fixture' },
      })
      const body = await readJsonSafe<{ user?: { id?: string } }>(response)
      userId = body?.user?.id ?? null
      expect(response.status()).toBe(201)
      expectId(userId, 'Accepted invitation user')
      const roles = await withClient(async (client) => client.query<{ role_id: string }>(
        'select role_id from customer_user_roles where user_id = $1', [userId],
      ))
      expect(roles.rows.map((role) => role.role_id)).toEqual([assignableRoleId])
    } finally {
      await withClient(async (client) => {
        const accepted = await client.query<{ id: string }>(
          'select user_id as id from customer_user_roles where role_id = $1', [assignableRoleId],
        )
        userId ??= accepted.rows[0]?.id ?? null
        await client.query('delete from customer_user_invitations where id = $1', [invitationId])
      })
      await deleteCustomerUserFixture(request, adminToken, userId)
      await deleteCustomerRoleFixture(request, adminToken, restrictedRoleId)
      await deleteCustomerRoleFixture(request, adminToken, assignableRoleId)
    }
  })
})
