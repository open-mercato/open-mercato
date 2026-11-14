import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createOrganizationFixture } from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'

type Scope = { tenantId: string; organizationId: string }

type SearchSettingsResponse = {
  settings?: {
    strategies?: Array<{ id?: unknown; available?: unknown }>
  }
}

type SearchResponse = {
  results?: Array<{ entityId?: unknown; presenter?: { title?: unknown } | null }>
}

type ReindexResponse = { ok?: unknown; error?: unknown }

const COMPANY_ENTITY = 'customers:customer_company_profile'
const FULLTEXT_QUEUE = 'fulltext-indexing'

function appBaseUrl(): string {
  const baseUrl = new URL(process.env.BASE_URL || 'http://localhost:3000')
  if (baseUrl.hostname === '127.0.0.1') baseUrl.hostname = 'localhost'
  return baseUrl.origin
}

function scopedRequest(
  request: APIRequestContext,
  method: string,
  path: string,
  options: { token: string; scope: Scope; data?: unknown },
): Promise<APIResponse> {
  return request.fetch(`${appBaseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${options.token}`,
      Cookie: [
        `om_selected_tenant=${encodeURIComponent(options.scope.tenantId)}`,
        `om_selected_org=${encodeURIComponent(options.scope.organizationId)}`,
      ].join('; '),
      'Content-Type': 'application/json',
      Origin: appBaseUrl(),
    },
    data: options.data,
  })
}

async function countFulltextHits(
  request: APIRequestContext,
  token: string,
  scope: Scope,
  name: string,
): Promise<number> {
  const params = new URLSearchParams({ q: name, limit: '10', strategies: 'fulltext', entityTypes: COMPANY_ENTITY })
  const response = await scopedRequest(request, 'GET', `/api/search/search?${params.toString()}`, { token, scope })
  if (!response.ok()) return -1
  const body = ((await readJsonSafe<SearchResponse>(response)) ?? {}) as SearchResponse
  const results = Array.isArray(body.results) ? body.results : []
  return results.filter((result) => result.entityId === COMPANY_ENTITY && result.presenter?.title === name).length
}

async function createCompany(request: APIRequestContext, token: string, scope: Scope, name: string): Promise<string> {
  const response = await scopedRequest(request, 'POST', '/api/customers/companies', {
    token,
    scope,
    data: { displayName: name },
  })
  expect(response.status(), `company fixture ${name} should be created`).toBe(201)
  const body = await readJsonSafe<{ id?: string; entityId?: string }>(response)
  return expectId(body?.id ?? body?.entityId, 'company create response should contain an id')
}

async function reindex(
  request: APIRequestContext,
  token: string,
  scope: Scope,
  data: { entityId?: string; useQueue: boolean },
): Promise<void> {
  await scopedRequest(request, 'POST', '/api/search/reindex/cancel', { token, scope }).catch(() => undefined)
  const response = await scopedRequest(request, 'POST', '/api/search/reindex', { token, scope, data })
  const body = await readJsonSafe<ReindexResponse>(response)
  expect(response.status(), `reindex ${JSON.stringify(data)} should succeed: ${JSON.stringify(body)}`).toBe(200)
  expect(body?.ok, `reindex ${JSON.stringify(data)} should report ok`).toBe(true)
  if (data.useQueue) await drainIntegrationQueue(FULLTEXT_QUEUE)
}

/**
 * Removes a company from the database without emitting any event, so its fulltext document
 * stays in the index until a reindex clears it — the "stale document" a reindex must remove.
 */
async function removeCompanyBehindTheIndex(companyEntityId: string): Promise<void> {
  await withClient(async (client) => {
    const removed = await client.query<{ id: string }>(
      'delete from customer_companies where entity_id = $1 returning id',
      [companyEntityId],
    )
    expect(removed.rowCount, 'stale company profile should be removed').toBe(1)
    const recordIds = [companyEntityId, ...removed.rows.map((row) => row.id)]
    await client.query('delete from entity_indexes where entity_id = any($1::text[])', [recordIds])
    await client.query('update customer_entities set deleted_at = now() where id = $1', [companyEntityId])
  })
}

/**
 * TC-SEARCH-016: organization-scoped fulltext reindex clears and rebuilds only that organization.
 *
 * Meilisearch keeps one index per tenant, shared by every organization. An organization-scoped
 * reindex — of one entity type or of every entity type, applied directly or through the
 * fulltext queue — must drop that organization's stale documents and rebuild its live ones,
 * while another organization of the same tenant and another tenant keep their documents.
 * Skips when the environment has no fulltext (Meilisearch) backend.
 */
test.describe('TC-SEARCH-016: organization-scoped fulltext reindex keeps other organizations and tenants searchable', () => {
  test('entity and full reindex, direct and queued, only touch the reindexed organization', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'superadmin')
    const homeTenantId = getTokenContext(token).tenantId
    const stamp = Date.now()
    const companyIds: Array<{ id: string; scope: Scope }> = []
    let organizationAId: string | null = null
    let organizationBId: string | null = null
    let otherTenantId: string | null = null
    let otherOrganizationId: string | null = null

    try {
      organizationAId = await createOrganizationFixture(request, token, {
        name: `QA TC-SEARCH-016 A ${stamp}`,
        tenantId: homeTenantId,
      })
      organizationBId = await createOrganizationFixture(request, token, {
        name: `QA TC-SEARCH-016 B ${stamp}`,
        tenantId: homeTenantId,
      })
      const scopeA: Scope = { tenantId: homeTenantId, organizationId: organizationAId }
      const scopeB: Scope = { tenantId: homeTenantId, organizationId: organizationBId }

      const settingsResponse = await scopedRequest(request, 'GET', '/api/search/settings', { token, scope: scopeA })
      expect(settingsResponse.ok()).toBeTruthy()
      const settings = ((await readJsonSafe<SearchSettingsResponse>(settingsResponse)) ?? {}) as SearchSettingsResponse
      const strategies = Array.isArray(settings.settings?.strategies) ? settings.settings.strategies : []
      if (!strategies.some((strategy) => strategy.id === 'fulltext' && strategy.available === true)) {
        test.skip(true, 'Fulltext strategy is not available in this environment')
        return
      }

      const tenantResponse = await apiRequest(request, 'POST', '/api/directory/tenants', {
        token,
        data: { name: `QA TC-SEARCH-016 Tenant ${stamp}` },
      })
      expect(tenantResponse.status(), 'tenant fixture should be created').toBe(201)
      otherTenantId = expectId((await readJsonSafe<{ id?: string }>(tenantResponse))?.id, 'tenant id')
      otherOrganizationId = await createOrganizationFixture(request, token, {
        name: `QA TC-SEARCH-016 C ${stamp}`,
        tenantId: otherTenantId,
      })
      const scopeOtherTenant: Scope = { tenantId: otherTenantId, organizationId: otherOrganizationId }

      const names = {
        aLive: `QATCSEARCH016ALIVE${stamp}`,
        b: `QATCSEARCH016B${stamp}`,
        otherTenant: `QATCSEARCH016T${stamp}`,
      }
      const phases = [
        { label: 'entity reindex, direct', data: { entityId: COMPANY_ENTITY, useQueue: false } },
        { label: 'entity reindex, queued', data: { entityId: COMPANY_ENTITY, useQueue: true } },
        { label: 'full reindex, direct', data: { useQueue: false } },
        { label: 'full reindex, queued', data: { useQueue: true } },
      ].map((phase, index) => ({ ...phase, staleName: `QATCSEARCH016S${index}${stamp}`, staleId: '' }))

      const track = async (scope: Scope, name: string) => {
        const id = await createCompany(request, token, scope, name)
        companyIds.push({ id, scope })
        return id
      }
      await track(scopeA, names.aLive)
      for (const phase of phases) phase.staleId = await track(scopeA, phase.staleName)
      await track(scopeB, names.b)
      await track(scopeOtherTenant, names.otherTenant)

      for (const scope of [scopeB, scopeOtherTenant, scopeA]) {
        await reindex(request, token, scope, { entityId: COMPANY_ENTITY, useQueue: false })
      }
      const expectSearchable = async (scope: Scope, name: string, message: string) => {
        await expect.poll(() => countFulltextHits(request, token, scope, name), { message, timeout: 30_000 }).toBe(1)
      }
      await expectSearchable(scopeA, names.aLive, 'organization A company should be indexed')
      for (const phase of phases) await expectSearchable(scopeA, phase.staleName, 'organization A fixture should be indexed')
      expect(
        await countFulltextHits(request, token, scopeB, names.b),
        'seeding organization A must keep the organization B documents indexed just before',
      ).toBe(1)
      await expectSearchable(scopeOtherTenant, names.otherTenant, 'other tenant company should be indexed')

      for (const phase of phases) {
        await removeCompanyBehindTheIndex(phase.staleId)
        expect(
          await countFulltextHits(request, token, scopeA, phase.staleName),
          `${phase.label}: the removed company must still be indexed before the reindex (stale document)`,
        ).toBe(1)

        await reindex(request, token, scopeA, phase.data)

        await expect
          .poll(() => countFulltextHits(request, token, scopeA, phase.staleName), {
            message: `${phase.label}: the stale organization A document must be cleared`,
            timeout: 30_000,
          })
          .toBe(0)
        await expectSearchable(scopeA, names.aLive, `${phase.label}: the live organization A company must be rebuilt`)
        expect(
          await countFulltextHits(request, token, scopeB, names.b),
          `${phase.label}: organization B must keep its documents`,
        ).toBe(1)
        expect(
          await countFulltextHits(request, token, scopeOtherTenant, names.otherTenant),
          `${phase.label}: the other tenant must keep its documents`,
        ).toBe(1)
      }
    } finally {
      for (const { id, scope } of companyIds) {
        await scopedRequest(request, 'DELETE', `/api/customers/companies?id=${encodeURIComponent(id)}`, {
          token,
          scope,
        }).catch(() => undefined)
      }
      for (const scope of [
        organizationAId ? { tenantId: homeTenantId, organizationId: organizationAId } : null,
        otherTenantId && otherOrganizationId ? { tenantId: otherTenantId, organizationId: otherOrganizationId } : null,
      ]) {
        if (scope) await scopedRequest(request, 'POST', '/api/search/reindex/cancel', { token, scope }).catch(() => undefined)
      }
      await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', organizationAId)
      await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', organizationBId)
      await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', otherOrganizationId)
      await deleteGeneralEntityIfExists(request, token, '/api/directory/tenants', otherTenantId)
    }
  })
})
