import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type ProviderAvailabilityEntry = { providerId: string; available: boolean; reason?: string }
type EmbeddingsSettings = {
  settings?: {
    providerAvailability?: ProviderAvailabilityEntry[]
  }
}
type SaveError = { error?: string; reason?: string }

/**
 * TC-SEARCH-011: the embeddings save guard rejects an unreachable provider.
 * Source: .ai/specs/2026-06-15-tenant-scoped-search-settings.md (Phase 3/4).
 *
 * POST /api/search/embeddings must reject selecting a provider the availability
 * probe reports unreachable with a 409 + structured reason, so a dead provider
 * (e.g. Ollama with nothing listening) can never be persisted. This is read-only
 * on the failure path (no state changes), so it is self-contained.
 */
test.describe('TC-SEARCH-011: save guard rejects an unavailable provider', () => {
  test('selecting Ollama while it is unreachable is rejected with 409 + reason', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const settingsResp = await apiRequest(request, 'GET', '/api/search/embeddings', { token })
    expect(settingsResp.ok(), 'admin should read embedding settings').toBeTruthy()
    const settings = (await readJsonSafe<EmbeddingsSettings>(settingsResp)) ?? {}
    const availability = settings.settings?.providerAvailability ?? []
    expect(Array.isArray(availability)).toBeTruthy()

    const ollama = availability.find((entry) => entry.providerId === 'ollama')
    test.skip(!ollama, 'provider availability not exposed by this build')
    test.skip(ollama?.available === true, 'Ollama is reachable in this environment; cannot exercise the rejection path')

    const response = await apiRequest(request, 'POST', '/api/search/embeddings', {
      token,
      data: { embeddingConfig: { providerId: 'ollama', model: 'nomic-embed-text', dimension: 768 } },
    })

    expect(response.status(), 'an unavailable provider must be rejected').toBe(409)
    const body = (await readJsonSafe<SaveError>(response)) ?? {}
    expect(typeof body.error, 'the rejection carries an error message').toBe('string')
    expect(body, 'the rejection exposes a structured reason').toHaveProperty('reason')
  })
})
