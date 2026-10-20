import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { apiRequestWithSelectedOrg } from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  createFeatureToggleFixture,
  deleteFeatureToggleIfExists,
} from '@open-mercato/core/helpers/integration/featureTogglesFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-QIDX-5723: a declared platform-wide catalogue (`feature_toggles:feature_toggle`) is
 * indexed once, under the null scope, and stays findable and unduplicated from a tenant
 * that has an organization selected.
 *
 * Earlier sweeps stamped the caller's tenant and organization. `entity_indexes` is unique on
 * (entity_type, entity_id, organization_id_coalesced), so such a row is a different key from
 * the canonical one and nothing rewrites it. The first case starts from a real stamped
 * projection, with its token and coverage rows, and checks that a reindex retires all three
 * and that later edits and the deletion of the source leave nothing stale behind.
 */

const CATALOGUE = 'feature_toggles:feature_toggle'
const REINDEX_TIMEOUT_MS = 60_000

type ScopeRow = { tenant_id: string | null; organization_id: string | null }

async function projectionScopes(entityId: string): Promise<ScopeRow[]> {
  return withClient(async (client) => {
    const result = await client.query<ScopeRow>(
      `select tenant_id, organization_id from entity_indexes
        where entity_type = $1 and entity_id = $2 and deleted_at is null`,
      [CATALOGUE, entityId],
    )
    return result.rows
  })
}

async function countStampedRows(table: 'search_tokens' | 'entity_index_coverage', tenantId: string): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ count: string }>(
      `select count(*)::text as count from ${table} where entity_type = $1 and tenant_id = $2`,
      [CATALOGUE, tenantId],
    )
    return Number(result.rows[0]?.count ?? 0)
  })
}

async function stampLegacyRows(entityId: string, tenantId: string, organizationId: string): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      `insert into entity_indexes (entity_type, entity_id, organization_id, tenant_id, doc, index_version, created_at, updated_at)
       select entity_type, entity_id, $3, $4, doc, index_version, now() - interval '1 day', now() - interval '1 day'
         from entity_indexes
        where entity_type = $1 and entity_id = $2 and tenant_id is null and organization_id is null`,
      [CATALOGUE, entityId, organizationId, tenantId],
    )
    await client.query(
      `insert into search_tokens (entity_type, entity_id, organization_id, tenant_id, field, token_hash, created_at)
       values ($1, $2, $3, $4, 'name', $5, now() - interval '1 day')`,
      [CATALOGUE, entityId, organizationId, tenantId, `tc-qidx-5723-${entityId}`],
    )
    await client.query(
      `insert into entity_index_coverage (entity_type, tenant_id, organization_id, with_deleted, base_count, indexed_count, refreshed_at)
       values ($1, $2, $3, false, 1, 1, now() - interval '1 day')
       on conflict do nothing`,
      [CATALOGUE, tenantId, organizationId],
    )
  })
}

async function removeIndexResidue(entityId: string | null, tenantId: string): Promise<void> {
  await withClient(async (client) => {
    if (entityId) {
      await client.query('delete from entity_indexes where entity_type = $1 and entity_id = $2', [CATALOGUE, entityId])
      await client.query('delete from search_tokens where entity_type = $1 and entity_id = $2', [CATALOGUE, entityId])
    }
    await client.query('delete from entity_index_coverage where entity_type = $1 and tenant_id = $2', [CATALOGUE, tenantId])
  })
}

async function reindexCatalogue(request: APIRequestContext, token: string): Promise<void> {
  const response = await apiRequest(request, 'POST', '/api/query_index/reindex', {
    token,
    data: { entityType: CATALOGUE },
  })
  expect(response.ok(), `POST /api/query_index/reindex: ${response.status()}`).toBeTruthy()
}

test.describe('TC-QIDX-5723: platform-wide catalogue in the query index', () => {
  test('a reindex retires an organization-stamped projection with its tokens and coverage', async ({ request }) => {
    test.setTimeout(180_000)
    const token = await getAuthToken(request, 'superadmin')
    const { tenantId, organizationId } = getTokenContext(token)
    const stamp = Date.now()
    let toggleId: string | null = null

    try {
      toggleId = await createFeatureToggleFixture(request, token, {
        identifier: `qa_qidx_5723_${stamp}`,
        name: `Catalogue retirement ${stamp}`,
        category: 'qa',
        type: 'boolean',
        defaultValue: true,
      })
      const createdId = toggleId
      await expect.poll(() => projectionScopes(createdId), { timeout: 15_000 })
        .toEqual([{ tenant_id: null, organization_id: null }])

      await stampLegacyRows(createdId, tenantId, organizationId)
      expect(await projectionScopes(createdId)).toHaveLength(2)
      expect(await countStampedRows('search_tokens', tenantId)).toBeGreaterThan(0)

      await reindexCatalogue(request, token)
      await expect.poll(() => projectionScopes(createdId), { timeout: REINDEX_TIMEOUT_MS })
        .toEqual([{ tenant_id: null, organization_id: null }])
      await expect.poll(() => countStampedRows('search_tokens', tenantId), { timeout: REINDEX_TIMEOUT_MS }).toBe(0)
      expect(await countStampedRows('entity_index_coverage', tenantId)).toBe(0)

      const update = await apiRequest(request, 'PUT', '/api/feature_toggles/global', {
        token,
        data: { id: createdId, name: `Catalogue retirement renamed ${stamp}` },
      })
      expect(update.status()).toBe(200)
      await expect.poll(async () => {
        const rows = await withClient(async (client) => (await client.query<{ name: string | null; tenant_id: string | null }>(
          `select doc->>'name' as name, tenant_id from entity_indexes where entity_type = $1 and entity_id = $2`,
          [CATALOGUE, createdId],
        )).rows)
        return rows
      }, { timeout: 15_000 }).toEqual([{ name: `Catalogue retirement renamed ${stamp}`, tenant_id: null }])

      const removal = await apiRequest(request, 'DELETE', `/api/feature_toggles/global?id=${encodeURIComponent(createdId)}`, { token })
      expect(removal.status()).toBe(200)
      toggleId = null
      await expect.poll(() => projectionScopes(createdId), { timeout: 15_000 }).toEqual([])
    } finally {
      await deleteFeatureToggleIfExists(request, token, toggleId)
      await removeIndexResidue(toggleId, tenantId).catch(() => undefined)
    }
  })

  test('a search with an organization selected returns the reindexed catalogue record', async ({ request }) => {
    test.setTimeout(180_000)
    const token = await getAuthToken(request, 'superadmin')
    const { tenantId, organizationId } = getTokenContext(token)
    const stamp = Date.now()
    const term = `zephyrcatalogue${stamp}`
    let toggleId: string | null = null

    try {
      toggleId = await createFeatureToggleFixture(request, token, {
        identifier: `qa_qidx_5723_search_${stamp}`,
        name: term,
        category: 'qa',
        type: 'boolean',
        defaultValue: false,
      })
      await reindexCatalogue(request, token)

      const createdId = toggleId
      await expect.poll(async () => {
        const response = await apiRequestWithSelectedOrg(
          request,
          'GET',
          `/api/search/search?q=${encodeURIComponent(term)}&strategies=tokens&entityTypes=${encodeURIComponent(CATALOGUE)}`,
          { token, selectedOrgId: organizationId },
        )
        const body = await readJsonSafe<{ results?: Array<{ entityId?: string; recordId?: string }> }>(response)
        return (body?.results ?? []).filter((result) => result.entityId === CATALOGUE).map((result) => result.recordId)
      }, { timeout: REINDEX_TIMEOUT_MS }).toEqual([createdId])
    } finally {
      await deleteFeatureToggleIfExists(request, token, toggleId)
      await removeIndexResidue(toggleId, tenantId).catch(() => undefined)
    }
  })
})
