import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'

/**
 * TC-CAT-026: tier-pricing tie-break selects the more specific tier (#1706 / PR #2454).
 *
 * When two same-kind tier prices both match the pricing context, the resolver
 * (`selectBestPrice` via `GET /api/catalog/products?quantity=N`) must pick the
 * tier with the higher `minQuantity` — the standard volume-discount semantic.
 * Issue body repro: qty 3, tiers minQty 2 ($9) and minQty 3 ($8) → minQty 3 ($8) wins.
 */

async function ensureTierPriceKind(
  request: APIRequestContext,
  token: string,
): Promise<{ id: string; currencyCode: string }> {
  const stamp = Date.now()
  const response = await apiRequest(request, 'POST', '/api/catalog/price-kinds', {
    token,
    data: {
      title: `Tier tie-break kind ${stamp}`,
      code: `tier_tiebreak_${stamp}`,
      displayMode: 'including-tax',
      currencyCode: 'USD',
    },
  })
  expect(response.ok(), `Failed to create price kind fixture: ${response.status()}`).toBeTruthy()
  const body = (await response.json()) as { id?: string; result?: { id?: string } }
  const id = typeof body.id === 'string' ? body.id : body.result?.id
  expect(typeof id === 'string' && (id as string).length > 0, 'Price kind id missing').toBeTruthy()
  return { id: id as string, currencyCode: 'USD' }
}

async function createTierPrice(
  request: APIRequestContext,
  token: string,
  input: { productId: string; priceKindId: string; currencyCode: string; minQuantity: number; amount: number },
): Promise<void> {
  const response = await apiRequest(request, 'POST', '/api/catalog/prices', {
    token,
    data: {
      productId: input.productId,
      priceKindId: input.priceKindId,
      currencyCode: input.currencyCode,
      minQuantity: input.minQuantity,
      unitPriceNet: input.amount,
      unitPriceGross: input.amount,
    },
  })
  expect(response.ok(), `Failed to create tier price (minQty ${input.minQuantity}): ${response.status()}`).toBeTruthy()
}

async function resolvePricingAtQuantity(
  request: APIRequestContext,
  token: string,
  productId: string,
  quantity: number,
): Promise<{ minQuantity: number; gross: number } | null> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/catalog/products?id=${encodeURIComponent(productId)}&quantity=${quantity}&page=1&pageSize=1`,
    { token },
  )
  expect(response.ok(), `Failed to resolve product pricing: ${response.status()}`).toBeTruthy()
  const body = (await response.json()) as { items?: Array<Record<string, unknown>> }
  const row = Array.isArray(body.items) ? body.items[0] : null
  const pricing = row && typeof row.pricing === 'object' ? (row.pricing as Record<string, unknown>) : null
  if (!pricing) return null
  return {
    minQuantity: Number(pricing.min_quantity),
    gross: Number(pricing.unit_price_gross),
  }
}

test.describe('TC-CAT-026 tier pricing tie-break', () => {
  test('same-kind tier tie-break selects the higher minQuantity at the matching quantity (#1706)', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let productId: string | null = null
    const stamp = Date.now()

    try {
      const priceKind = await ensureTierPriceKind(request, token)
      productId = await createProductFixture(request, token, {
        title: `Tier tie-break product ${stamp}`,
        sku: `TIER-TB-${stamp}`,
      })

      // Two same-kind tiers; the higher-volume tier is cheaper per unit.
      await createTierPrice(request, token, {
        productId,
        priceKindId: priceKind.id,
        currencyCode: priceKind.currencyCode,
        minQuantity: 2,
        amount: 9,
      })
      await createTierPrice(request, token, {
        productId,
        priceKindId: priceKind.id,
        currencyCode: priceKind.currencyCode,
        minQuantity: 3,
        amount: 8,
      })

      // At qty 3 both tiers match; the more specific (minQty 3, $8) must win.
      const atThree = await resolvePricingAtQuantity(request, token, productId!, 3)
      expect(atThree, 'Expected resolved pricing at quantity 3').not.toBeNull()
      expect(atThree!.minQuantity).toBe(3)
      expect(atThree!.gross).toBeCloseTo(8, 4)

      // At qty 2 only the minQty 2 tier matches, so it resolves to $9.
      const atTwo = await resolvePricingAtQuantity(request, token, productId!, 2)
      expect(atTwo, 'Expected resolved pricing at quantity 2').not.toBeNull()
      expect(atTwo!.minQuantity).toBe(2)
      expect(atTwo!.gross).toBeCloseTo(9, 4)
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
