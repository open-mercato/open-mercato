import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type GlobalSearchSettings = {
  enabledStrategies?: string[]
  source?: 'tenant' | 'instance' | 'env'
}
type EmbeddingsSettings = {
  settings?: {
    embeddingConfig?: unknown
    embeddingConfigSource?: 'tenant' | 'instance' | 'env'
  }
}

const DEFAULT_STRATEGIES = ['fulltext', 'vector', 'tokens']

/**
 * TC-SEARCH-010: search settings carry a tenant-scope source discriminator.
 * Source: .ai/specs/2026-06-15-tenant-scoped-search-settings.md (Phase 2).
 *
 * The settings APIs are tenant-scoped: GET reports a `source` of tenant | instance
 * | env, and a tenant admin's POST writes only its own scoped row (subsequent GET
 * reports `source: 'tenant'`). This spec is self-contained — it restores the
 * tenant's original global-search strategies in `finally`.
 */
test.describe('TC-SEARCH-010: tenant-scoped search settings expose a source', () => {
  test('global-search GET exposes source and POST round-trips as a tenant override', async ({ request }) => {
    let token: string | null = null
    let original: string[] | null = null

    try {
      token = await getAuthToken(request, 'admin')

      const before = await apiRequest(request, 'GET', '/api/search/settings/global-search', { token })
      expect(before.ok(), 'admin should read global-search settings').toBeTruthy()
      const beforeBody = (await readJsonSafe<GlobalSearchSettings>(before)) ?? {}
      expect(Array.isArray(beforeBody.enabledStrategies)).toBeTruthy()
      original = beforeBody.enabledStrategies ?? DEFAULT_STRATEGIES
      expect(['tenant', 'instance', 'env']).toContain(beforeBody.source)

      const next = original.includes('vector')
        ? original.filter((strategy) => strategy !== 'vector')
        : [...original, 'vector']
      const safeNext = next.length > 0 ? next : ['tokens']

      const update = await apiRequest(request, 'POST', '/api/search/settings/global-search', {
        token,
        data: { enabledStrategies: safeNext },
      })
      expect(update.ok(), 'admin should update global-search settings').toBeTruthy()

      const after = await apiRequest(request, 'GET', '/api/search/settings/global-search', { token })
      const afterBody = (await readJsonSafe<GlobalSearchSettings>(after)) ?? {}
      expect(afterBody.enabledStrategies?.sort()).toEqual([...safeNext].sort())
      expect(afterBody.source, 'after a tenant save the source is the tenant row').toBe('tenant')
    } finally {
      if (token && original) {
        await apiRequest(request, 'POST', '/api/search/settings/global-search', {
          token,
          data: { enabledStrategies: original },
        }).catch(() => undefined)
      }
    }
  })

  test('embeddings GET exposes the embedding config source', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'GET', '/api/search/embeddings', { token })
    expect(response.ok(), 'admin should read embedding settings').toBeTruthy()
    const body = (await readJsonSafe<EmbeddingsSettings>(response)) ?? {}
    expect(['tenant', 'instance', 'env']).toContain(body.settings?.embeddingConfigSource)
  })
})
