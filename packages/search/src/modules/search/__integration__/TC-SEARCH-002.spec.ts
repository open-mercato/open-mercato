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

test.describe('TC-SEARCH-002: vector reindex handles invalid entity requests', () => {
  test('returns a structured failure for an entity that is not configured for search', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    const entityId = `search:missing-debug-coverage-${Date.now()}`

    const response = await apiRequest(request, 'POST', '/api/search/embeddings/reindex', {
      token,
      data: {
        entityId,
        purgeFirst: false,
      },
    })

    expect(response.status()).toBe(200)

    const body = await readJsonSafe<VectorReindexResponse>(response)
    expect(body?.ok).toBe(false)
    expect(body?.recordsIndexed).toBe(0)
    expect(body?.entitiesProcessed).toBe(0)
    expect(Array.isArray(body?.errors)).toBe(true)
    expect(body?.errors?.[0]?.entityId).toBe(entityId)
    expect(typeof body?.errors?.[0]?.error).toBe('string')
    expect(body?.errors?.[0]?.error?.length ?? 0).toBeGreaterThan(0)
  })
})
