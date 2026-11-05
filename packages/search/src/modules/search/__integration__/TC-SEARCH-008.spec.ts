import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

type IndexEntry = { entityId?: string; recordId?: string }
type IndexResponse = { entries?: IndexEntry[]; limit?: number; offset?: number }

const COMPANY_ENTITY = 'customers:customer_company_profile'

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
    const companyIds: string[] = []
    const stamp = Date.now()

    try {
      token = await getAuthToken(request, 'admin')

      // The endpoint must be queryable (200). A 503 (vector strategy unavailable)
      // or 500 (no embedding config / vector table) means the index cannot be
      // paginated in this environment — skip rather than fail.
      const probe = await getIndex(request, token, {})
      if (probe.status !== 200) {
        test.skip(true, `vector index is not listable in this environment (status ${probe.status})`)
        return
      }

      for (let i = 0; i < 3; i += 1) {
        companyIds.push(await createCompanyFixture(request, token, `QASRCH008-${stamp}-${i}`))
      }

      // Trigger a (queued) vector reindex and wait for rows to materialize.
      await apiRequest(request, 'POST', '/api/search/embeddings/reindex', {
        token,
        data: { entityId: COMPANY_ENTITY },
      }).catch(() => undefined)

      let entries: IndexEntry[] = []
      for (let attempt = 0; attempt < 20; attempt += 1) {
        entries = (await getIndex(request, token, {})).body.entries ?? []
        if (entries.length >= 2) break
        await new Promise((resolve) => setTimeout(resolve, 1_000))
      }
      if (entries.length < 2) {
        test.skip(true, 'vector index did not reach 2 entries; the embedding pipeline does not produce rows here')
        return
      }

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
      const filtered = await getIndex(request, token, { entityId: COMPANY_ENTITY, limit: '50' })
      expect((filtered.body.entries ?? []).length, 'company entityId filter returns at least our fixtures').toBeGreaterThan(
        0,
      )
      for (const entry of filtered.body.entries ?? []) {
        expect(entry.entityId, 'entityId filter returns only that entity type').toBe(COMPANY_ENTITY)
      }
    } finally {
      // Vector reindex acquires a lock that its route does NOT release (workers
      // own it), so explicitly cancel to avoid leaving a lock behind.
      if (token) {
        await apiRequest(request, 'POST', '/api/search/embeddings/reindex/cancel', { token }).catch(() => undefined)
      }
      for (const id of companyIds) {
        await deleteEntityIfExists(request, token, '/api/customers/companies', id)
      }
    }
  })
})
