import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

const WATCHES_PATH = '/api/marketing_automation/watches'
const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

type WatchBody = { id?: string; sku?: string; created?: boolean; watchedPriceGross?: string | null; updatedAt?: string }

/**
 * TC-MA-026: price watches.
 *
 * The rules worth asserting: one watch per customer and product, asking twice does not reset the reference
 * price a drop is measured from, and the demand list aggregates by product rather than listing every watch.
 */
test.describe('TC-MA-026 price watches', () => {
  test('a watch is idempotent per customer and product, and stopping it frees the pair', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const customerId = await createPersonFixture(request, token, {
      firstName: 'Watching',
      lastName: `Customer${stamp}`,
      displayName: `Watching Customer ${stamp}`,
      primaryEmail: `qa-ma-watch-${stamp}@example.com`,
    })
    const sku = `QA-WATCH-${stamp}`
    let watch: WatchBody | null = null

    try {
      const created = await apiRequest(request, 'POST', WATCHES_PATH, {
        token,
        data: { customerId, sku, currencyCode: 'usd' },
      })
      expect(created.status()).toBe(200)
      watch = await readJsonSafe<WatchBody>(created)
      expect(watch?.created).toBe(true)
      expect(watch?.sku).toBe(sku)

      const again = await apiRequest(request, 'POST', WATCHES_PATH, {
        token,
        data: { customerId, sku, currencyCode: 'USD' },
      })
      expect(again.status()).toBe(200)
      const second = await readJsonSafe<WatchBody>(again)
      // Not created again, and — the part that matters — the same reference price, because resetting it would
      // cancel a drop the customer was already owed.
      expect(second?.created).toBe(false)
      expect(second?.id).toBe(watch?.id)
      expect(second?.watchedPriceGross ?? null).toBe(watch?.watchedPriceGross ?? null)

      const demand = await readJsonSafe<{ items?: Array<{ sku?: string; watchers?: number }> }>(
        await apiRequest(request, 'GET', `${WATCHES_PATH}?limit=200`, { token }),
      )
      expect((demand?.items ?? []).find((item) => item.sku === sku)?.watchers).toBe(1)

      const profile = await readJsonSafe<{ watches?: Array<{ sku?: string; currencyCode?: string }> }>(
        await apiRequest(request, 'GET', `/api/marketing_automation/customers/${customerId}/profile`, { token }),
      )
      const listed = (profile?.watches ?? []).find((item) => item.sku === sku)
      expect(listed).toBeTruthy()
      // Normalised on the way in, so a storefront sending lower case does not create a second currency.
      expect(listed?.currencyCode).toBe('USD')

      const stopped = await apiRequest(request, 'DELETE', `${WATCHES_PATH}/${watch!.id}`, {
        token,
        headers: { [LOCK_HEADER]: second!.updatedAt ?? watch!.updatedAt! },
      })
      expect(stopped.status()).toBe(200)
      watch = null

      // The pair is free again: the same customer may watch the same product from a fresh reference.
      const restarted = await apiRequest(request, 'POST', WATCHES_PATH, {
        token,
        data: { customerId, sku, currencyCode: 'USD' },
      })
      expect(restarted.status()).toBe(200)
      const restartedBody = await readJsonSafe<WatchBody>(restarted)
      expect(restartedBody?.created).toBe(true)
      if (restartedBody?.id) {
        await apiRequest(request, 'DELETE', `${WATCHES_PATH}/${restartedBody.id}`, {
          token,
          headers: { [LOCK_HEADER]: restartedBody.updatedAt! },
        })
      }
    } finally {
      if (watch?.id && watch.updatedAt) {
        await apiRequest(request, 'DELETE', `${WATCHES_PATH}/${watch.id}`, { token, headers: { [LOCK_HEADER]: watch.updatedAt } })
      }
      await deleteEntityIfExists(request, token, '/api/customers/people', customerId)
    }
  })

  test('a watch cannot be created for a customer that does not exist', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'POST', WATCHES_PATH, {
      token,
      data: { customerId: '00000000-0000-0000-0000-000000000000', sku: 'QA-NOBODY', currencyCode: 'USD' },
    })
    expect(response.status()).toBe(404)
  })

  test('an unusable payload is refused', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    for (const data of [
      { sku: 'QA', currencyCode: 'USD' },
      { customerId: '00000000-0000-0000-0000-000000000000', currencyCode: 'USD' },
      { customerId: '00000000-0000-0000-0000-000000000000', sku: 'QA', currencyCode: 'EUROS' },
    ]) {
      const response = await apiRequest(request, 'POST', WATCHES_PATH, { token, data })
      expect(response.status()).toBe(400)
    }
  })

  test('the palette offers the price-drop trigger with the context a campaign needs', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const body = await readJsonSafe<{ triggers?: Array<{ eventId?: string; available?: boolean; contextKeys?: string[] }> }>(
      await apiRequest(request, 'GET', '/api/marketing_automation/palette', { token }),
    )
    const trigger = (body?.triggers ?? []).find((entry) => entry.eventId === 'marketing_automation.product.price_dropped')
    expect(trigger?.available).toBe(true)
    // The drop size is what separates "any change" from "a real discount" in an audience.
    expect(trigger?.contextKeys).toContain('trigger.dropPercent')
  })

  test('an anonymous caller can neither list nor create watches', async ({ request }) => {
    expect([401, 403]).toContain((await request.get(WATCHES_PATH)).status())
    expect([401, 403]).toContain((await request.post(WATCHES_PATH, { data: { sku: 'x' } })).status())
  })
})
