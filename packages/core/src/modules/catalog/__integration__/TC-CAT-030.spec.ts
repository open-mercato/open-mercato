import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-CAT-030: Dictionary lookup for the catalog `currency` and `unit` dictionaries.
 * Source: issue #2484 (catalog integration coverage), scenario TC-CAT-030.
 *
 * `GET /api/catalog/dictionaries/[key]` resolves `keys = KEY_ALIASES[key] ?? [key]`
 * and matches stored dictionaries with `key IN keys`. The aliases are keyed by the
 * CANONICAL request key, so requesting `currency` also matches a dictionary stored
 * under `currencies`/`measurement_units`, but requesting the plural form directly
 * is NOT mapped back to the canonical key — it resolves to `[plural]`, finds no
 * stored dictionary, and returns 404. The `currency` and `unit` dictionaries are
 * always-present reference data (`seedDefaults`: catalog seeds `unit`, customers
 * seeds `currency`); the sibling `.meta.ts` gates this test on both modules.
 *
 * Note for #2484: the issue assumed the plural alias resolves to the same
 * dictionary. It does not (see assertions below) — flagged as a likely-unintended
 * asymmetry in the KEY_ALIASES lookup.
 */
type DictionaryResponse = {
  id?: string
  entries?: Array<{ id: string; value: string; label: string; color: string | null; icon: string | null }>
}

test.describe('TC-CAT-030: Dictionary key lookup', () => {
  test('currency canonical key returns the seeded dictionary; the plural form is not a request alias', async ({
    request,
  }) => {
    const token = await getAuthToken(request)

    const currencyRes = await apiRequest(request, 'GET', '/api/catalog/dictionaries/currency', {
      token,
    })
    expect(currencyRes.status(), `currency lookup failed: ${currencyRes.status()}`).toBe(200)
    const currency = (await currencyRes.json()) as DictionaryResponse
    expect(typeof currency.id === 'string' && currency.id.length > 0).toBeTruthy()
    expect(Array.isArray(currency.entries) && (currency.entries?.length ?? 0) > 0).toBeTruthy()
    const firstEntry = currency.entries?.[0]
    expect(firstEntry).toHaveProperty('id')
    expect(firstEntry).toHaveProperty('value')
    expect(firstEntry).toHaveProperty('label')
    expect(firstEntry).toHaveProperty('color')
    expect(firstEntry).toHaveProperty('icon')

    // KEY_ALIASES maps the canonical key to accepted STORED keys, not the reverse,
    // so the plural request key has no backing dictionary.
    const pluralRes = await apiRequest(request, 'GET', '/api/catalog/dictionaries/currencies', {
      token,
    })
    expect(pluralRes.status()).toBe(404)
  })

  test('unit canonical key returns the seeded dictionary; the plural form is not a request alias', async ({
    request,
  }) => {
    const token = await getAuthToken(request)

    const unitRes = await apiRequest(request, 'GET', '/api/catalog/dictionaries/unit', { token })
    expect(unitRes.status(), `unit lookup failed: ${unitRes.status()}`).toBe(200)
    const unit = (await unitRes.json()) as DictionaryResponse
    expect(typeof unit.id === 'string' && unit.id.length > 0).toBeTruthy()
    expect(Array.isArray(unit.entries) && (unit.entries?.length ?? 0) > 0).toBeTruthy()

    const pluralRes = await apiRequest(request, 'GET', '/api/catalog/dictionaries/units', { token })
    expect(pluralRes.status()).toBe(404)
  })

  test('an unmapped dictionary key returns 404', async ({ request }) => {
    const token = await getAuthToken(request)
    const missingKey = `qa-nonexistent-${Date.now()}`

    const res = await apiRequest(
      request,
      'GET',
      `/api/catalog/dictionaries/${encodeURIComponent(missingKey)}`,
      { token },
    )
    expect(res.status()).toBe(404)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toBe('Dictionary not found.')
  })
})
