import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture, createRoleFixture, createUserFixture,
  deleteOrganizationIfExists, deleteRoleIfExists, deleteUserIfExists, setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

type Mapping = { id: string; organizationId: string; hostname: string }
const endpoint = '/api/customer_accounts/admin/domain-mappings'

async function register(request: APIRequestContext, token: string, organizationId: string, hostname: string, replacesDomainId?: string): Promise<Mapping> {
  const response = await apiRequest(request, 'POST', endpoint, { token, data: { organizationId, hostname, replacesDomainId } })
  expect(response.status(), await response.text()).toBe(201)
  const body = await readJsonSafe<{ domainMapping: Mapping }>(response)
  expect(body?.domainMapping.id).toBeTruthy()
  return body!.domainMapping
}

async function snapshot(ids: string[]): Promise<unknown[]> {
  return withClient(async (client) => (await client.query<{ row: unknown }>(
    'select row_to_json(mapping) as row from domain_mappings mapping where id = any($1::uuid[]) order by id', [ids],
  )).rows.map((row) => row.row))
}

test('domain management uses feature grants for the target organization across real HTTP and persisted records', async ({ request }) => {
  test.setTimeout(120_000)
  const administrator = await getAuthToken(request, 'superadmin')
  const { tenantId } = getTokenContext(administrator)
  const stamp = randomUUID().replace(/-/g, '')
  const organizationIds: string[] = []
  const roleIds: string[] = []
  const mappingIds: string[] = []
  let userId: string | null = null
  let foreignTenantId: string | null = null
  try {
    const organizationA = await createOrganizationFixture(request, administrator, { name: `Domain A ${stamp}` })
    organizationIds.push(organizationA)
    const organizationB = await createOrganizationFixture(request, administrator, { name: `Domain B ${stamp}` })
    organizationIds.push(organizationB)
    const managerRole = await createRoleFixture(request, administrator, { name: `domain-manager-${stamp}` })
    roleIds.push(managerRole)
    await setRoleAclFeatures(request, administrator, {
      roleId: managerRole, features: ['customer_accounts.domain.manage'], organizations: [organizationA],
    })
    const visibilityRole = await createRoleFixture(request, administrator, { name: `domain-reader-${stamp}` })
    roleIds.push(visibilityRole)
    await setRoleAclFeatures(request, administrator, {
      roleId: visibilityRole, features: ['directory.organizations.view'], organizations: [organizationA, organizationB],
    })
    const email = `domain-scope-${stamp}@example.com`
    const password = `Domain-${stamp}!9`
    userId = await createUserFixture(request, administrator, {
      email, password, organizationId: organizationA, roles: [managerRole, visibilityRole],
    })
    const actor = await getAuthToken(request, email, password)
    const mappingA = await register(request, administrator, organizationA, `a-${stamp}.invalid`)
    mappingIds.push(mappingA.id)
    const mappingB = await register(request, administrator, organizationB, `b-${stamp}.invalid`)
    mappingIds.push(mappingB.id)

    const createTenant = await apiRequest(request, 'POST', '/api/directory/tenants', {
      token: administrator, data: { name: `Domain foreign ${stamp}` },
    })
    expect(createTenant.status(), await createTenant.text()).toBe(201)
    foreignTenantId = (await readJsonSafe<{ id: string }>(createTenant))!.id
    const foreignOrganization = await createOrganizationFixture(request, administrator, {
      name: `Domain foreign org ${stamp}`, tenantId: foreignTenantId,
    })
    organizationIds.push(foreignOrganization)
    const foreignMappingId = randomUUID()
    mappingIds.push(foreignMappingId)
    await withClient((client) => client.query(
      'insert into domain_mappings (id, hostname, tenant_id, organization_id, provider, status, tls_retry_count, created_at) values ($1, $2, $3, $4, $5, $6, 0, now())',
      [foreignMappingId, `foreign-${stamp}.invalid`, foreignTenantId, foreignOrganization, 'traefik', 'pending'],
    ))

    const visible = await apiRequest(request, 'GET', '/api/directory/organizations?pageSize=100', { token: actor })
    expect(visible.status()).toBe(200)
    const visibleBody = await readJsonSafe<{ items: Array<{ id: string }> }>(visible)
    expect(visibleBody!.items.map((item) => item.id)).toEqual(expect.arrayContaining([organizationA, organizationB]))
    for (const query of ['', `?organizationId=${organizationA}`]) {
      const response = await apiRequest(request, 'GET', `${endpoint}${query}`, { token: actor })
      expect(response.status()).toBe(200)
      const body = await readJsonSafe<{ domainMappings: Mapping[] }>(response)
      expect(body!.domainMappings.map((mapping) => mapping.id)).toEqual([mappingA.id])
    }
    const filteredB = await apiRequest(request, 'GET', `${endpoint}?organizationId=${organizationB}`, { token: actor })
    expect(filteredB.status()).toBe(403)

    const protectedBefore = await snapshot([mappingB.id, foreignMappingId])
    const deniedCreate = await apiRequest(request, 'POST', endpoint, {
      token: actor, data: { hostname: `denied-${stamp}.invalid`, organizationId: organizationB },
    })
    expect(deniedCreate.status()).toBe(403)
    for (const [mappingId, expectedStatus] of [[mappingB.id, 403], [foreignMappingId, 404]] as const) {
      const deletion = await apiRequest(request, 'DELETE', `${endpoint}?id=${mappingId}`, { token: actor })
      expect(deletion.status()).toBe(expectedStatus)
      for (const action of ['verify', 'health-check']) {
        const response = await apiRequest(request, 'POST', `${endpoint}/${mappingId}/${action}`, { token: actor })
        expect(response.status()).toBe(expectedStatus)
      }
    }
    expect(await snapshot([mappingB.id, foreignMappingId])).toEqual(protectedBefore)
    await withClient(async (client) => {
      const count = await client.query<{ total: string }>('select count(*)::text as total from domain_mappings where hostname = $1', [`denied-${stamp}.invalid`])
      expect(count.rows[0].total).toBe('0')
    })

    const verification = await apiRequest(request, 'POST', `${endpoint}/${mappingA.id}/verify`, { token: actor })
    expect(verification.status(), await verification.text()).toBe(200)
    await withClient((client) => client.query('update domain_mappings set status = $2 where id = $1 and tenant_id = $3 and organization_id = $4', [mappingA.id, 'active', tenantId, organizationA]))
    const health = await apiRequest(request, 'POST', `${endpoint}/${mappingA.id}/health-check`, { token: actor })
    expect(health.status(), await health.text()).toBe(200)
    const replacement = await register(request, actor, organizationA, `replacement-${stamp}.invalid`, mappingB.id)
    mappingIds.push(replacement.id)
    await withClient(async (client) => {
      const rows = await client.query<{ replaces_domain_id: string | null }>('select replaces_domain_id from domain_mappings where id = $1', [replacement.id])
      expect(rows.rows[0].replaces_domain_id).toBeNull()
    })
    const removal = await apiRequest(request, 'DELETE', `${endpoint}?id=${replacement.id}`, { token: actor })
    expect(removal.status(), await removal.text()).toBe(200)
    expect(await snapshot([mappingB.id, foreignMappingId])).toEqual(protectedBefore)
  } finally {
    await withClient((client) => client.query('delete from domain_mappings where id = any($1::uuid[])', [mappingIds])).catch(() => undefined)
    await deleteUserIfExists(request, administrator, userId)
    for (const roleId of roleIds.reverse()) await deleteRoleIfExists(request, administrator, roleId)
    for (const organizationId of organizationIds.reverse()) await deleteOrganizationIfExists(request, administrator, organizationId)
    if (foreignTenantId) await apiRequest(request, 'DELETE', `/api/directory/tenants?id=${foreignTenantId}`, { token: administrator }).catch(() => undefined)
  }
})
