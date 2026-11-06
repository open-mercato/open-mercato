import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createUserFixture } from '@open-mercato/core/helpers/integration/authFixtures'
import { customerTestPassword } from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { createOrganizationInDb, setUserAclInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['customers', 'auth', 'directory', 'audit_logs', 'query_index'] }

test('TC-CRM-8675: company creates require live organizations owned by the authorized tenant', async ({ request }) => {
  const rootToken = await getAuthToken(request, 'superadmin')
  const tenantIds = [randomUUID(), randomUUID()]
  const organizationIds: string[] = []
  const userIds: string[] = []
  const marker = `tc8675-${randomUUID()}`
  const password = customerTestPassword()

  async function actor(organizations: string[] | null): Promise<string> {
    const email = `${marker}-${userIds.length}@example.com`
    const userId = await createUserFixture(request, rootToken, {
      email, password, organizationId: organizationIds[0], roles: [],
    })
    userIds.push(userId)
    await setUserAclInDb({ userId, tenantId: tenantIds[0], features: ['customers.companies.*'], organizations })
    return getAuthToken(request, email, password)
  }

  async function expectNoCompanyWrites(): Promise<void> {
    await withClient(async (client) => {
      for (const table of ['customer_entities', 'customer_companies']) {
        const result = await client.query<{ count: string }>(`select count(*) from ${table} where tenant_id = any($1::uuid[])`, [tenantIds])
        expect(Number(result.rows[0].count), `${table} should have no rows after denial`).toBe(0)
      }
      const logs = await client.query<{ count: string }>(
        "select count(*) from action_logs where tenant_id = any($1::uuid[]) and command_id = 'customers.companies.create' and execution_state = 'done'", [tenantIds],
      )
      expect(Number(logs.rows[0].count), 'no successful company create audit side effects').toBe(0)
      const indexes = await client.query<{ count: string }>(
        "select count(*) from entity_indexes where tenant_id = any($1::uuid[]) and entity_type in ('customers:customer_entity', 'customers:customer_company_profile')", [tenantIds],
      )
      expect(Number(indexes.rows[0].count), 'no successful company index side effects').toBe(0)
    })
  }

  try {
    await withClient(async (client) => {
      for (const tenantId of tenantIds) {
        await client.query('insert into tenants (id, name, is_active, created_at, updated_at) values ($1, $2, true, now(), now())', [tenantId, marker])
      }
    })
    for (const [index, tenantId] of [tenantIds[0], tenantIds[0], tenantIds[1], tenantIds[0]].entries()) {
      organizationIds.push(await createOrganizationInDb({ name: `${marker}-${index}`, tenantId }))
    }
    const [home, sibling, foreign, deleted] = organizationIds
    await withClient((client) => client.query('update organizations set deleted_at = now() where id = $1', [deleted]))
    const unrestricted = await actor(null)
    const restricted = await actor([home])
    const empty = await actor([])

    const cases = [
      { name: 'foreign organization', token: unrestricted, data: { organizationId: foreign } },
      { name: 'unknown organization', token: unrestricted, data: { organizationId: randomUUID() } },
      { name: 'deleted organization', token: unrestricted, data: { organizationId: deleted } },
      { name: 'foreign tenant input', token: unrestricted, data: { tenantId: tenantIds[1], organizationId: foreign }, error: 'Not authorized to target this tenant.' },
      { name: 'restricted organization', token: restricted, data: { organizationId: sibling } },
      { name: 'empty organization ACL', token: empty, data: { organizationId: home } },
    ]
    for (const invalid of cases) {
      const response = await apiRequest(request, 'POST', '/api/customers/companies', {
        token: invalid.token, headers: { Cookie: '' },
        data: { displayName: `${marker}-${invalid.name}`, ...invalid.data },
      })
      expect(response.status(), invalid.name).toBe(403)
      expect(await readJsonSafe<{ error?: string }>(response), invalid.name).toMatchObject({ error: invalid.error ?? 'Forbidden' })
      expect(response.headers()['x-om-operation'], 'denial should not issue a successful undo operation').toBeUndefined()
      await expectNoCompanyWrites()
    }

    const invalidSelection = await apiRequest(request, 'POST', '/api/customers/companies', {
      token: unrestricted, headers: { Cookie: `om_selected_org=${foreign}` }, data: { displayName: `${marker}-invalid-selection` },
    })
    expect(invalidSelection.status(), 'invalid explicit selection must retain the selection guard').toBe(422)
    expect(await readJsonSafe<{ error?: string; code?: string }>(invalidSelection)).toMatchObject({ code: 'organization_selection_invalid' })
    await expectNoCompanyWrites()

    for (const valid of [
      { organizationId: home, tenantId: tenantIds[0], token: unrestricted, selectedOrg: home, explicit: false },
      { organizationId: sibling, tenantId: tenantIds[0], token: unrestricted, selectedOrg: home, explicit: true },
      { organizationId: foreign, tenantId: tenantIds[1], token: rootToken, selectedOrg: foreign, explicit: true },
    ]) {
      const { organizationId, tenantId } = valid
      const created = await apiRequest(request, 'POST', '/api/customers/companies', {
        token: valid.token, headers: { Cookie: `om_selected_tenant=${tenantId}; om_selected_org=${valid.selectedOrg}` },
        data: { displayName: `${marker}-valid-${organizationId}`, ...(valid.explicit ? { organizationId, tenantId } : {}) },
      })
      expect(created.status(), 'omitted or explicit authorized organization should create').toBe(201)
      const body = await readJsonSafe<{ id: string; companyId: string }>(created)
      expect(body?.id).toBeTruthy()
      await withClient(async (client) => {
        const rows = await client.query<{ tenant_id: string; organization_id: string; profile_tenant_id: string; profile_organization_id: string }>(
          `select entity.tenant_id, entity.organization_id, profile.tenant_id as profile_tenant_id, profile.organization_id as profile_organization_id
           from customer_entities entity join customer_companies profile on profile.entity_id = entity.id
           where entity.id = $1 and profile.id = $2`, [body?.id, body?.companyId],
        )
        expect(rows.rows).toEqual([{ tenant_id: tenantId, organization_id: organizationId, profile_tenant_id: tenantId, profile_organization_id: organizationId }])
      })
      const foreignMutation = { token: restricted, headers: { Cookie: '' }, data: { id: body?.id, displayName: `${marker}-forbidden-update` } }
      if (organizationId !== home) {
        const read = await apiRequest(request, 'GET', `/api/customers/companies/${body?.id}`, { token: restricted, headers: { Cookie: '' } })
        expect(read.status(), 'detail must retain scope isolation without an existence oracle').toBe(404)
        const updated = await apiRequest(request, 'PUT', '/api/customers/companies', foreignMutation)
        expect(updated.status(), 'update must retain organization isolation').toBe(403)
        const removed = await apiRequest(request, 'DELETE', '/api/customers/companies', { ...foreignMutation, data: { id: body?.id } })
        expect(removed.status(), 'delete must retain organization isolation').toBe(403)
      }
    }
  } finally {
    await withClient(async (client) => {
      const entities = await client.query<{ id: string }>('select id from customer_entities where tenant_id = any($1::uuid[])', [tenantIds])
      const entityIds = entities.rows.map((row) => row.id)
      await client.query('delete from customer_companies where tenant_id = any($1::uuid[])', [tenantIds])
      await client.query('delete from customer_entities where tenant_id = any($1::uuid[])', [tenantIds])
      await client.query('delete from action_logs where tenant_id = any($1::uuid[]) or actor_user_id = any($2::uuid[])', [tenantIds, userIds])
      await client.query('delete from entity_indexes where tenant_id = any($1::uuid[]) or entity_id = any($2::text[])', [tenantIds, entityIds])
      await client.query('delete from search_tokens where tenant_id = any($1::uuid[])', [tenantIds])
      await client.query('delete from sessions where user_id = any($1::uuid[])', [userIds])
      await client.query('delete from user_acls where user_id = any($1::uuid[])', [userIds])
      await client.query('delete from user_roles where user_id = any($1::uuid[])', [userIds])
      await client.query('delete from users where id = any($1::uuid[])', [userIds])
      await client.query('delete from organizations where id = any($1::uuid[])', [organizationIds])
      await client.query('delete from tenants where id = any($1::uuid[])', [tenantIds])
    })
  }
})
