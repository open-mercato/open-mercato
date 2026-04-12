import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type VectorReindexResponse = {
  ok?: boolean
  recordsIndexed?: number
  jobsEnqueued?: number
  entitiesProcessed?: number
  errors?: Array<{
    entityId?: string
    error?: string
  }>
}

type SearchSettingsResponse = {
  settings?: {
    vectorReindexLock?: {
      type?: 'vector'
      action?: string
      startedAt?: string
      elapsedMinutes?: number
      processedCount?: number | null
      totalCount?: number | null
    } | null
  }
}

test.describe('TC-SEARCH-002: vector reindex handles invalid entity requests', () => {
  test('returns a structured failure for an entity that is not configured for search', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const entityId = `search:missing-debug-coverage-${Date.now()}`
    const settingsResponse = await apiRequest(request, 'GET', '/api/search/settings', { token })
    expect(settingsResponse.ok()).toBeTruthy()

    const settingsBody = await readJsonSafe<SearchSettingsResponse>(settingsResponse)
    test.skip(
      Boolean(settingsBody?.settings?.vectorReindexLock),
      'Vector reindex already in progress for this tenant; refusing to cancel shared work in a reused environment'
    )

    let shouldCancelReindex = false

    try {
      const response = await apiRequest(request, 'POST', '/api/search/embeddings/reindex', {
        token,
        data: {
          entityId,
          purgeFirst: false,
        },
      })
      shouldCancelReindex = response.status() !== 409

      expect(response.status()).toBe(200)

      const body = await readJsonSafe<VectorReindexResponse>(response)
      expect(body?.ok).toBe(false)
      expect(body?.recordsIndexed).toBe(0)
      expect(body?.entitiesProcessed).toBe(0)
      expect(body?.jobsEnqueued ?? 0).toBe(0)
      expect(body?.errors).toEqual([
        {
          entityId,
          error: 'Entity not configured for search',
        },
      ])
    } finally {
      if (shouldCancelReindex) {
        const cancelResponse = await apiRequest(request, 'POST', '/api/search/embeddings/reindex/cancel', {
          token,
        })
        expect(cancelResponse.ok()).toBeTruthy()
      }
    }
  })
})
