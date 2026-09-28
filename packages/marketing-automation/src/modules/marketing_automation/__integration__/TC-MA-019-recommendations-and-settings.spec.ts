import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const SETTINGS_PATH = '/api/marketing_automation/settings'

type Settings = { productUrlTemplate?: string; loyaltyTiers?: Array<{ key?: string; minPoints?: number }> }

/**
 * TC-MA-019: recommendations on the profile, and the settings that were unreachable before.
 *
 * The recommendation numbers depend on whatever order history the installation has, so the assertions are
 * about SHAPE and about the rules that must hold whatever the data is.
 */
test.describe('TC-MA-019 recommendations and settings', () => {
  test('the send step offers a recommendation count', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'GET', '/api/marketing_automation/palette', { token })
    const body = await readJsonSafe<{ steps?: Array<{ type?: string; uiFields?: Array<{ name?: string; kind?: string }> }> }>(response)
    const step = (body?.steps ?? []).find((entry) => entry.type === 'send_email')
    const field = (step?.uiFields ?? []).find((entry) => entry.name === 'recommendationCount')
    expect(field?.kind).toBe('number')
  })

  test('the customer profile reports what the next message would offer', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const list = await apiRequest(request, 'GET', '/api/customers/people?pageSize=1', { token })
    const people = await readJsonSafe<{ items?: Array<{ id?: string; entityId?: string }> }>(list)
    const customerId = people?.items?.[0]?.entityId ?? people?.items?.[0]?.id
    test.skip(!customerId, 'no customer available in this installation')

    const response = await apiRequest(request, 'GET', `/api/marketing_automation/customers/${customerId}/profile`, { token })
    expect(response.status()).toBe(200)
    const profile = await readJsonSafe<{
      recommendations?: Array<{ sku?: string; name?: string; source?: string }>
    }>(response)

    expect(Array.isArray(profile?.recommendations)).toBe(true)
    const items = profile?.recommendations ?? []
    // Five is what the profile asks for; the ranker's own ceiling is higher.
    expect(items.length).toBeLessThanOrEqual(5)

    const malformed = items.filter((item) => !item.sku || !item.name || !['affinity', 'bestSeller'].includes(String(item.source)))
    expect(malformed).toEqual([])

    // Nothing may appear twice: two signals feed the list and both can name the same product.
    const skus = items.map((item) => item.sku)
    expect(new Set(skus).size).toBe(skus.length)
  })

  test('settings round-trip, and a template without {sku} is refused', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const before = await apiRequest(request, 'GET', SETTINGS_PATH, { token })
    expect(before.status()).toBe(200)
    const original = await readJsonSafe<Settings>(before)
    expect(Array.isArray(original?.loyaltyTiers)).toBe(true)
    // A ladder is always returned, because the engine always has one to fall back on.
    expect((original?.loyaltyTiers ?? []).length).toBeGreaterThan(0)

    try {
      const saved = await apiRequest(request, 'PUT', SETTINGS_PATH, {
        token,
        data: {
          productUrlTemplate: 'https://shop.example/p/{sku}',
          // Deliberately out of order: the endpoint stores a normalised ladder.
          loyaltyTiers: [{ key: 'gold', minPoints: 500 }, { key: 'bronze', minPoints: 0 }],
        },
      })
      expect(saved.status()).toBe(200)
      const body = await readJsonSafe<Settings>(saved)
      expect(body?.productUrlTemplate).toBe('https://shop.example/p/{sku}')
      expect((body?.loyaltyTiers ?? []).map((tier) => tier.key)).toEqual(['bronze', 'gold'])

      const refused = await apiRequest(request, 'PUT', SETTINGS_PATH, {
        token,
        data: { productUrlTemplate: 'https://shop.example/products' },
      })
      expect(refused.status()).toBe(400)

      // An empty template is allowed: it is how a shop says it has nowhere to link to.
      const cleared = await apiRequest(request, 'PUT', SETTINGS_PATH, { token, data: { productUrlTemplate: '' } })
      expect(cleared.status()).toBe(200)
    } finally {
      await apiRequest(request, 'PUT', SETTINGS_PATH, {
        token,
        data: {
          productUrlTemplate: original?.productUrlTemplate ?? '',
          loyaltyTiers: original?.loyaltyTiers ?? [],
        },
      })
    }
  })

  test('an anonymous caller cannot read the settings', async ({ request }) => {
    const response = await request.get(SETTINGS_PATH)
    expect([401, 403]).toContain(response.status())
  })
})
