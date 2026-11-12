import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createOrganizationInDb, deleteOrganizationInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  createCustomerCompanyFixture,
  createCustomerRoleFixture,
  createCustomerUserFixture,
  deleteCustomerCompanyFixture,
  deleteCustomerRoleFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'

export const integrationMeta = { dependsOnModules: ['customer_accounts', 'customers', 'portal'] }

test.describe('TC-PORTAL-013: portal authentication uses persisted scope', () => {
  test.beforeEach(() => {
    expect(process.env.OM_INTEGRATION_TEST, 'DB fixtures require the isolated CLI integration runner').toBe('true')
  })

  test('an issued token follows the current company rather than its stale company claim', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(adminToken)
    const companyIds: string[] = []
    const userIds: string[] = []
    let roleId: string | null = null

    try {
      const companyBefore = await createCustomerCompanyFixture(request, adminToken)
      companyIds.push(companyBefore)
      const companyAfter = await createCustomerCompanyFixture(request, adminToken)
      companyIds.push(companyAfter)
      const role = await createCustomerRoleFixture(request, adminToken, { features: ['portal.users.view'] })
      roleId = role.id
      const actor = await createCustomerUserFixture(request, adminToken, { customerEntityId: companyBefore, roleIds: [role.id] })
      userIds.push(actor.id)
      const previousPeer = await createCustomerUserFixture(request, adminToken, { customerEntityId: companyBefore })
      userIds.push(previousPeer.id)
      const currentPeer = await createCustomerUserFixture(request, adminToken, { customerEntityId: companyAfter })
      userIds.push(currentPeer.id)
      const session = await portalLogin(request, { email: actor.email, password: actor.password, tenantId })
      const headers = portalCookieHeaders(session)
      const before = await request.get('/api/customer_accounts/portal/users', { headers })
      expect(before.status()).toBe(200)
      const previousUsers = await readJsonSafe<{ users: Array<{ id: string }> }>(before)
      expect(previousUsers?.users.map((user) => user.id)).toEqual(expect.arrayContaining([actor.id, previousPeer.id]))
      expect(previousUsers?.users.map((user) => user.id)).not.toContain(currentPeer.id)

      await withClient(async (client) => {
        const result = await client.query(
          'update customer_users set customer_entity_id = $1, updated_at = now() where id = $2 and tenant_id = $3 and organization_id = $4',
          [companyAfter, actor.id, tenantId, organizationId],
        )
        expect(result.rowCount).toBe(1)
      })

      const after = await request.get('/api/customer_accounts/portal/users', { headers })
      expect(after.status()).toBe(200)
      const currentUsers = await readJsonSafe<{ users: Array<{ id: string }> }>(after)
      expect(currentUsers?.users.map((user) => user.id)).toEqual(expect.arrayContaining([actor.id, currentPeer.id]))
      expect(currentUsers?.users.map((user) => user.id)).not.toContain(previousPeer.id)
    } finally {
      for (const userId of userIds.reverse()) await deleteCustomerUserFixture(request, adminToken, userId)
      await deleteCustomerRoleFixture(request, adminToken, roleId)
      for (const companyId of companyIds.reverse()) await deleteCustomerCompanyFixture(request, adminToken, companyId)
    }
  })

  for (const changedScope of ['organization', 'tenant'] as const) {
    test('request and server-cookie authentication reject a persisted ' + changedScope + ' change', async ({ request }) => {
      const adminToken = await getAuthToken(request, 'admin')
      const { tenantId, organizationId: adminOrganizationId } = getTokenContext(adminToken)
      let fixtureOrganizationId: string | null = null
      let organizationId = adminOrganizationId
      let userId: string | null = null
      let alternateTenantId: string | null = null
      let alternateOrganizationId: string | null = null
      let moved = false

      try {
        const user = await createCustomerUserFixture(request, adminToken)
        userId = user.id
        const slug = 'tc-portal-013-' + randomUUID()
        fixtureOrganizationId = await createOrganizationInDb({ name: slug, tenantId })
        await withClient(async (client) => {
          await client.query('update organizations set slug = $1 where id = $2 and tenant_id = $3', [slug, fixtureOrganizationId, tenantId])
          const result = await client.query(
            'update customer_users set organization_id = $1, updated_at = now() where id = $2 and tenant_id = $3 and organization_id = $4',
            [fixtureOrganizationId, user.id, tenantId, adminOrganizationId],
          )
          expect(result.rowCount).toBe(1)
        })
        organizationId = fixtureOrganizationId
        const profilePath = '/' + encodeURIComponent(slug) + '/portal/profile'
        const session = await portalLogin(request, { email: user.email, password: user.password, tenantId })
        const headers = portalCookieHeaders(session)
        expect((await request.get('/api/customer_accounts/portal/profile', { headers })).status()).toBe(200)
        expect((await request.get(profilePath, { headers, maxRedirects: 0 })).status()).toBe(200)

        if (changedScope === 'tenant') {
          alternateTenantId = randomUUID()
          await withClient(async (client) => {
            await client.query(
              'insert into tenants (id, name, is_active, created_at, updated_at) values ($1, $2, true, now(), now())',
              [alternateTenantId, 'TC PORTAL 013 ' + alternateTenantId],
            )
          })
        }
        const targetTenantId = alternateTenantId ?? tenantId
        alternateOrganizationId = await createOrganizationInDb({ name: 'TC PORTAL 013 ' + randomUUID(), tenantId: targetTenantId })
        await withClient(async (client) => {
          const result = await client.query(
            'update customer_users set tenant_id = $1, organization_id = $2, updated_at = now() where id = $3 and tenant_id = $4 and organization_id = $5',
            [targetTenantId, alternateOrganizationId, user.id, tenantId, organizationId],
          )
          expect(result.rowCount).toBe(1)
        })
        moved = true

        const profile = await request.get('/api/customer_accounts/portal/profile', { headers })
        expect(profile.status()).toBe(401)
        const page = await request.get(profilePath, { headers, maxRedirects: 0 })
        expect([302, 303, 307, 308]).toContain(page.status())
        expect(page.headers().location).toContain('/portal/login')
      } finally {
        if (userId && fixtureOrganizationId) {
          await withClient(async (client) => {
            await client.query(
              'update customer_users set tenant_id = $1, organization_id = $2, updated_at = now() where id = $3 and tenant_id = $4 and organization_id = $5',
              [tenantId, adminOrganizationId, userId, moved ? alternateTenantId ?? tenantId : tenantId, moved ? alternateOrganizationId : fixtureOrganizationId],
            )
            await client.query(
              'delete from customer_user_sessions as session using customer_users as owned_user where session.user_id = owned_user.id and owned_user.id = $1 and owned_user.tenant_id = $2 and owned_user.organization_id = $3',
              [userId, tenantId, adminOrganizationId],
            )
          })
        }
        await deleteCustomerUserFixture(request, adminToken, userId)
        await deleteOrganizationInDb(fixtureOrganizationId)
        await deleteOrganizationInDb(alternateOrganizationId)
        if (alternateTenantId) {
          await withClient(async (client) => { await client.query('delete from tenants where id = $1', [alternateTenantId]) })
        }
      }
    })
  }
})
