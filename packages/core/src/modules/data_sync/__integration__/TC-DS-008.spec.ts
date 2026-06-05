import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJson, uniqueIntegrationId, type JsonRecord } from './helpers/support'
import { decodeTokenScope, deleteSyncRunsByIntegration, seedSyncRuns, type SeedSyncRunInput } from './helpers/db'

/**
 * TC-DS-008: Run list pagination boundaries and maxPageSize
 *
 * Implements issue #2475 scenario "TC-DS-007 — Run list pagination boundaries
 * and maxPageSize" (renumbered to avoid existing TC-DS files).
 *
 * `listSyncRunsQuerySchema` enforces page >= 1 and 1 <= pageSize <= 100; out-of-
 * range values return 400 ("Invalid query") before any DB access. Page math is
 * verified against deterministically-seeded runs (distinct createdAt → stable
 * DESC ordering) scoped to a per-run-unique integration id.
 */

test.describe('TC-DS-008: Data sync run list pagination', () => {
  test('rejects out-of-range page and pageSize with 400', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const maxAllowed = await apiRequest(request, 'GET', '/api/data_sync/runs?page=1&pageSize=100', { token })
    expect(maxAllowed.status()).toBe(200)

    const tooLarge = await apiRequest(request, 'GET', '/api/data_sync/runs?page=1&pageSize=101', { token })
    expect(tooLarge.status()).toBe(400)

    const zeroPage = await apiRequest(request, 'GET', '/api/data_sync/runs?page=0&pageSize=20', { token })
    expect(zeroPage.status()).toBe(400)

    const zeroPageSize = await apiRequest(request, 'GET', '/api/data_sync/runs?page=1&pageSize=0', { token })
    expect(zeroPageSize.status()).toBe(400)
  })

  test('paginates seeded runs with correct page math and ordering', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = decodeTokenScope(token)
    const integrationId = uniqueIntegrationId('test_ds008')
    const entityType = 'catalog.product'

    const total = 25
    const now = Date.now()
    // index 0 = newest; createdAt steps of 1s keep DESC ordering stable
    const seeds: SeedSyncRunInput[] = Array.from({ length: total }, (_, index) => ({
      ...scope,
      integrationId,
      entityType,
      direction: 'import',
      status: 'completed',
      createdAt: new Date(now - index * 1000),
    }))
    const seededIds = await seedSyncRuns(seeds)

    const idsFor = (body: JsonRecord): string[] => (body.items as JsonRecord[]).map((item) => String(item.id))

    try {
      const page1Res = await apiRequest(
        request,
        'GET',
        `/api/data_sync/runs?integrationId=${integrationId}&page=1&pageSize=20`,
        { token },
      )
      expect(page1Res.status()).toBe(200)
      const page1 = await readJson(page1Res)
      expect(page1.total).toBe(total)
      expect(page1.page).toBe(1)
      expect(page1.pageSize).toBe(20)
      expect(page1.totalPages).toBe(2)
      const page1Ids = idsFor(page1)
      expect(page1Ids).toHaveLength(20)
      expect(page1Ids).toEqual(seededIds.slice(0, 20))

      const page2Res = await apiRequest(
        request,
        'GET',
        `/api/data_sync/runs?integrationId=${integrationId}&page=2&pageSize=20`,
        { token },
      )
      const page2 = await readJson(page2Res)
      const page2Ids = idsFor(page2)
      expect(page2Ids).toHaveLength(5)
      expect(page2Ids).toEqual(seededIds.slice(20))

      // Pages are disjoint
      const page1IdSet = new Set(page1Ids)
      expect(page2Ids.every((id) => !page1IdSet.has(id))).toBe(true)

      // pageSize=100 returns the whole set in a single page
      const allRes = await apiRequest(
        request,
        'GET',
        `/api/data_sync/runs?integrationId=${integrationId}&page=1&pageSize=100`,
        { token },
      )
      const all = await readJson(allRes)
      expect(idsFor(all)).toHaveLength(total)
      expect(all.totalPages).toBe(1)
    } finally {
      await deleteSyncRunsByIntegration(integrationId)
    }
  })
})
