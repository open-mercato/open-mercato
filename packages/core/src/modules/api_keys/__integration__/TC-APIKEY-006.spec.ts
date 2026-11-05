import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * TC-APIKEY-006: expiresAt validation
 * Source: issue #2470
 *
 * Creating an API key with an expiry in the past is rejected (a past-dated key
 * would be useless / already expired). A future expiry is accepted and
 * persisted.
 */
test.describe('TC-APIKEY-006: API key expiresAt validation', () => {
  test('rejects an API key whose expiresAt is in the past', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const pastExpiry = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const response = await apiRequest(request, 'POST', '/api/api_keys/keys', {
      token,
      data: { name: `QA TC-APIKEY-006 past ${Date.now()}`, expiresAt: pastExpiry },
    })

    expect(response.ok(), 'a past expiresAt must be rejected').toBe(false)
    expect([400, 422]).toContain(response.status())

    // Defensive: if the API ever returned a body with an id, clean it up.
    const body = (await response.json().catch(() => null)) as { id?: string } | null
    if (body && typeof body.id === 'string') {
      await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${encodeURIComponent(body.id)}`, { token }).catch(() => {})
    }
  })

  test('accepts and persists an API key with a future expiresAt', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const futureExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const keyName = `QA TC-APIKEY-006 future ${Date.now()}`
    let keyId: string | null = null

    try {
      const createResponse = await apiRequest(request, 'POST', '/api/api_keys/keys', {
        token,
        data: { name: keyName, expiresAt: futureExpiry },
      })
      expect(createResponse.ok(), `a future expiresAt should be accepted: ${createResponse.status()}`).toBe(true)
      const created = (await createResponse.json()) as { id?: string }
      keyId = created.id ?? null
      expect(typeof created.id).toBe('string')

      // The persisted key should expose the configured expiry in the list.
      const listResponse = await apiRequest(request, 'GET', `/api/api_keys/keys?search=${encodeURIComponent(keyName)}`, { token })
      expect(listResponse.status()).toBe(200)
      const list = (await listResponse.json()) as { items?: Array<Record<string, unknown>> }
      const found = (list.items ?? []).find((item) => item.id === keyId)
      expect(found, 'created key should appear in the list').toBeTruthy()
      const persistedExpiry = (found as Record<string, unknown>).expiresAt
      expect(persistedExpiry, 'expiresAt should be persisted').toBeTruthy()
      expect(new Date(String(persistedExpiry)).getTime()).toBe(new Date(futureExpiry).getTime())
    } finally {
      if (keyId) {
        await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${encodeURIComponent(keyId)}`, { token }).catch(() => {})
      }
    }
  })
})
