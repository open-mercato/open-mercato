import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * TC-APIKEY-001: Create API key — one-time secret + list never leaks the secret
 * Source: issue #2470
 *
 * POST /api/api_keys/keys returns the full secret exactly once, with a public
 * 12-char `omk_` prefix. The subsequent list exposes the prefix but never the
 * secret.
 */
test.describe('TC-APIKEY-001: Create API key and verify one-time secret', () => {
  test('returns the secret once on create and only the prefix in the list', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const keyName = `QA TC-APIKEY-001 ${Date.now()}`
    let keyId: string | null = null

    try {
      const createResponse = await apiRequest(request, 'POST', '/api/api_keys/keys', {
        token,
        data: { name: keyName },
      })
      expect(createResponse.ok(), `create should succeed: ${createResponse.status()}`).toBe(true)

      const created = (await createResponse.json()) as {
        id?: string
        name?: string
        keyPrefix?: string
        secret?: string
        roles?: unknown[]
      }
      keyId = created.id ?? null

      expect(typeof created.id).toBe('string')
      expect((created.id as string).length).toBeGreaterThan(0)
      expect(created.name).toBe(keyName)
      expect(typeof created.secret).toBe('string')
      expect((created.secret as string).startsWith('omk_')).toBe(true)
      expect(typeof created.keyPrefix).toBe('string')
      expect((created.keyPrefix as string).length).toBe(12)
      expect((created.secret as string).slice(0, 12)).toBe(created.keyPrefix)
      expect(Array.isArray(created.roles)).toBe(true)

      // The list must show the key by prefix but never return the secret.
      const listResponse = await apiRequest(request, 'GET', `/api/api_keys/keys?search=${encodeURIComponent(keyName)}`, { token })
      expect(listResponse.status()).toBe(200)
      const list = (await listResponse.json()) as { items?: Array<Record<string, unknown>> }
      const found = (list.items ?? []).find((item) => item.name === keyName)
      expect(found, 'created key should appear in the list').toBeTruthy()
      expect((found as Record<string, unknown>).keyPrefix).toBe(created.keyPrefix)
      expect('secret' in (found as Record<string, unknown>)).toBe(false)
    } finally {
      if (keyId) {
        await apiRequest(request, 'DELETE', `/api/api_keys/keys?id=${encodeURIComponent(keyId)}`, { token }).catch(() => {})
      }
    }
  })
})
