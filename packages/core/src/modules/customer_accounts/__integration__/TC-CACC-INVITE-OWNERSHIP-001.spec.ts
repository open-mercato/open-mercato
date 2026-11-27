import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCustomerCompanyFixture,
  createCustomerRoleFixture,
  createCustomerUserFixture,
  deleteCustomerCompanyFixture,
  deleteCustomerRoleFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
  uniqueSuffix,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

const portalEndpoint = '/api/customer_accounts/portal/users-invite'
const adminEndpoint = '/api/customer_accounts/admin/users-invite'

async function invitationRow(id: string) {
  return withClient(async (client) => {
    const result = await client.query<Record<string, unknown>>(
      'select * from customer_user_invitations where id = $1',
      [id],
    )
    expect(result.rows).toHaveLength(1)
    return result.rows[0]
  })
}

test.describe('TC-CACC-INVITE-OWNERSHIP-001: pending invitation ownership', () => {
  for (const scenario of ['foreign-portal', 'foreign-staff', 'same-company-staff', 'same-company-portal'] as const) {
    test(`protects ${scenario} invitations while preserving authorized reinvites`, async ({ request }) => {
      const adminToken = await getAuthToken(request, 'admin')
      const { tenantId } = getTokenContext(adminToken)
      const companies: string[] = []
      const users: string[] = []
      let roleId: string | null = null
      let invitationId: string | null = null
      try {
        const companyA = await createCustomerCompanyFixture(request, adminToken)
        companies.push(companyA)
        const foreign = scenario.startsWith('foreign')
        const targetCompany = foreign ? await createCustomerCompanyFixture(request, adminToken) : companyA
        if (foreign) companies.push(targetCompany)
        roleId = (await createCustomerRoleFixture(request, adminToken, {
          features: ['portal.users.manage'], customerAssignable: true,
        })).id
        const caller = await createCustomerUserFixture(request, adminToken, { roleIds: [roleId], customerEntityId: companyA })
        users.push(caller.id)
        const callerSession = await portalLogin(request, { ...caller, tenantId })
        const email = `qa-invite-ownership-${uniqueSuffix()}@test.local`
        const payload = { email, roleIds: [roleId], displayName: 'Original recipient' }
        let created
        if (scenario.endsWith('staff')) {
          created = await apiRequest(request, 'POST', adminEndpoint, {
            token: adminToken, data: { ...payload, customerEntityId: targetCompany },
          })
        } else {
          const originalInviter = await createCustomerUserFixture(request, adminToken, {
            roleIds: [roleId], customerEntityId: targetCompany,
          })
          users.push(originalInviter.id)
          const originalSession = await portalLogin(request, { ...originalInviter, tenantId })
          created = await request.post(portalEndpoint, { headers: portalCookieHeaders(originalSession), data: payload })
        }
        expect(created.status()).toBe(201)
        const body = await readJsonSafe<{ invitation: { id: string } }>(created)
        invitationId = body!.invitation.id
        const before = await invitationRow(invitationId)

        const reinvite = await request.post(portalEndpoint, {
          headers: portalCookieHeaders(callerSession),
          data: { ...payload, displayName: 'Replacement recipient' },
        })
        const allowed = scenario === 'same-company-portal'
        expect(reinvite.status()).toBe(allowed ? 201 : 409)
        const after = await invitationRow(invitationId)
        if (allowed) {
          const result = await readJsonSafe<{ invitation: { id: string } }>(reinvite)
          expect(result!.invitation.id).toBe(invitationId)
          expect(after.token === before.token, 'authorized resend rotates the token').toBe(false)
          expect(after.customer_entity_id).toBe(companyA)
          expect(after.invited_by_customer_user_id).toBe(caller.id)
          expect(after.person_entity_id).toBe(before.person_entity_id)
        } else {
          expect(await readJsonSafe(reinvite)).toEqual({
            ok: false, error: 'This invitation cannot be sent. Contact your administrator.',
          })
          expect(after, 'a rejected portal request leaves every persisted field and the original token unchanged').toEqual(before)
        }
      } finally {
        if (invitationId) {
          await withClient((client) => client.query('delete from customer_user_invitations where id = $1', [invitationId]))
        }
        for (const id of users.reverse()) await deleteCustomerUserFixture(request, adminToken, id)
        await deleteCustomerRoleFixture(request, adminToken, roleId)
        for (const id of companies.reverse()) await deleteCustomerCompanyFixture(request, adminToken, id)
      }
    })
  }
})
