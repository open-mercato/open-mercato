import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'

export const integrationMeta = { dependsOnModules: ['search', 'catalog'] }

type IndexEntry = { entityId?: string; recordId?: string }
type IndexResponse = { entries?: IndexEntry[]; limit?: number; offset?: number }

const PRODUCT_ENTITY = 'catalog:catalog_product'

async function getIndex(
  request: APIRequestContext,
  token: string,
  params: Record<string, string>,
): Promise<{ status: number; body: IndexResponse }> {
  const qs = new URLSearchParams(params).toString()
  const res = await apiRequest(request, 'GET', `/api/search/index${qs ? `?${qs}` : ''}`, { token })
  const body = res.ok() ? ((await readJsonSafe<IndexResponse>(res)) ?? {}) : {}
  return { status: res.status(), body }
}

/**
 * TC-SEARCH-008: vector index list pagination & entityId filter.
 * Source: issue #2483.
 *
 * Route: GET /api/search/index (requireFeatures ['search.view']) returns the
 * vector-store entries (VectorIndexEntry: entityId, recordId, … — there is no
 * surrogate `id`) with limit/offset paging and an optional entityId filter.
 * Exercising it requires a working embedding pipeline (a provider key AND an
 * applied embedding config that produces indexed rows). When the index is not
 * listable — the endpoint returns 503 (vector strategy unavailable) or 500 (no
 * embedding config / vector table) — this test skips, mirroring how the
 * fulltext-dependent specs skip when Meilisearch is absent. The full pagination
 * contract runs only when the vector index is queryable and rows materialize.
 */
test.describe('TC-SEARCH-008: vector index list pagination & entityId filter', () => {
  test('paginates entries and filters by entityId', async ({ request }) => {
    test.slow()

    let token: string | null = null
    let vectorReindexQueued = false
    const productIds: string[] = []
    const stamp = Date.now()

    try {
      token = await getAuthToken(request, 'admin')

      // The endpoint must be queryable (200). A 503 (vector strategy unavailable)
      // or 500 (no embedding config / vector table) means the index cannot be
      // paginated in this environment — skip rather than fail.
      const probe = await getIndex(request, token, {})
      test.skip(probe.status === 503 || probe.status === 500, `vector index is not listable in this environment (status ${probe.status})`)
      expect(probe.status).toBe(200)

      for (const fixtureNumber of [1, 2, 3]) {
        const sku = `QASRCH008-${stamp}-${fixtureNumber}`
        productIds.push(await createProductFixture(request, token, { title: sku, sku }))
      }

      const reindex = await apiRequest(request, 'POST', '/api/search/embeddings/reindex', {
        token,
        data: { entityId: PRODUCT_ENTITY },
      })
      expect(reindex.status()).toBe(200)
      const reindexResult = await readJsonSafe<{ ok?: boolean; jobsEnqueued?: number }>(reindex)
      vectorReindexQueued = (reindexResult?.jobsEnqueued ?? 0) > 0
      expect(reindexResult).toMatchObject({ ok: true })
      expect(vectorReindexQueued, 'product vector reindex must queue jobs').toBe(true)
      await drainIntegrationQueue('vector-indexing')

      const authToken = token
      await expect.poll(async () => {
        const filtered = await getIndex(request, authToken, { entityId: PRODUCT_ENTITY, limit: '100' })
        return filtered.body.entries?.map((entry) => entry.recordId) ?? []
      }, { message: 'vector index must contain the product fixtures' }).toEqual(expect.arrayContaining(productIds))

      // Default paging metadata, with enough rows to page over.
      const base = await getIndex(request, token, {})
      expect(base.body.limit, 'default limit is 50').toBe(50)
      expect(base.body.offset, 'default offset is 0').toBe(0)
      expect((base.body.entries ?? []).length, 'index has at least two entries to page over').toBeGreaterThanOrEqual(2)

      // limit caps the page size and is echoed back.
      const limited = await getIndex(request, token, { limit: '1', offset: '0' })
      expect(limited.body.limit, 'response echoes the requested limit').toBe(1)
      expect(limited.body.entries?.length ?? 0, 'limit=1 returns at most one entry').toBeLessThanOrEqual(1)

      // A two-row page returns two DISTINCT records — proves paging yields
      // distinct rows (keyed on recordId, the stable per-record identifier).
      const pageOfTwo = await getIndex(request, token, { limit: '2', offset: '0' })
      const twoIds = (pageOfTwo.body.entries ?? []).map((entry) => entry.recordId)
      expect(twoIds.length, 'a limit=2 page returns two rows').toBe(2)
      expect(twoIds[0], 'each paged entry exposes a recordId').toBeTruthy()
      expect(twoIds[1], 'the two paged entries are distinct records').not.toBe(twoIds[0])

      // offset advances the window to a different record and is echoed back.
      const page2 = await getIndex(request, token, { limit: '1', offset: '1' })
      expect(page2.body.offset, 'response echoes the requested offset').toBe(1)
      const offset0Id = limited.body.entries?.[0]?.recordId
      const offset1Id = page2.body.entries?.[0]?.recordId
      expect(offset1Id, 'offset=1 returns a record').toBeTruthy()
      expect(offset1Id, 'offset=1 returns a different record than offset=0').not.toBe(offset0Id)

      // entityId filter narrows to the requested entity type (and is non-empty,
      // so the uniformity assertion is not vacuous).
      const filtered = await getIndex(request, token, { entityId: PRODUCT_ENTITY, limit: '2' })
      expect(filtered.body.entries).toMatchObject([{ entityId: PRODUCT_ENTITY }, { entityId: PRODUCT_ENTITY }])
    } finally {
      // Vector reindex acquires a lock that its route does NOT release (workers
      // own it), so explicitly cancel to avoid leaving a lock behind.
      if (token && vectorReindexQueued) {
        await apiRequest(request, 'POST', '/api/search/embeddings/reindex/cancel', { token }).catch(() => undefined)
      }
      for (const id of productIds) {
        await deleteCatalogProductIfExists(request, token, id)
      }
    }
  })
})
