import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'

async function ensurePriceKindId(
  request: APIRequestContext,
  token: string,
): Promise<{ id: string; currencyCode: string }> {
  const list = await apiRequest(request, 'GET', '/api/catalog/price-kinds?page=1&pageSize=1', { token })
  expect(list.ok(), `Failed to list price kinds: ${list.status()}`).toBeTruthy()
  const body = (await list.json()) as { items?: Array<Record<string, unknown>> }
  const first = body.items?.[0]
  if (first?.id) {
    const currency = (first.currency_code ?? first.currencyCode ?? 'USD') as string
    return { id: first.id as string, currencyCode: currency }
  }
  const stamp = Date.now()
  const create = await apiRequest(request, 'POST', '/api/catalog/price-kinds', {
    token,
    data: { title: `QA PK ${stamp}`, code: `qa_pk_${stamp}`, displayMode: 'including-tax', currencyCode: 'USD' },
  })
  expect(create.ok(), `Failed to create price kind: ${create.status()}`).toBeTruthy()
  const createBody = (await create.json()) as { id?: string; result?: { id?: string } }
  const id = createBody.id ?? createBody.result?.id
  expect(typeof id === 'string' && id.length > 0).toBeTruthy()
  return { id: id as string, currencyCode: 'USD' }
}

/** TC-CAT-024: Product with Multiple Variants */
test.describe('TC-CAT-024: Product with Multiple Variants', () => {
  test('should create 3 variants with different SKUs and prices, and verify all listed', async ({ request }) => {
    const suffix = Date.now()
    let token: string | null = null
    let productId: string | null = null

    try {
      token = await getAuthToken(request)
      const priceKind = await ensurePriceKindId(request, token)

      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-024 Product ${suffix}`,
        sku: `QA-CAT-024-BASE-${suffix}`,
      })

      const variantSkus = [
        `QA-CAT-024-V1-${suffix}`,
        `QA-CAT-024-V2-${suffix}`,
        `QA-CAT-024-V3-${suffix}`,
      ]
      const variantPrices = [10.0, 20.0, 30.0]
      const variantIds: string[] = []

      for (let i = 0; i < 3; i++) {
        const createRes = await apiRequest(request, 'POST', '/api/catalog/variants', {
          token,
          data: { productId, name: `Variant ${i + 1} ${suffix}`, sku: variantSkus[i] },
        })
        expect(createRes.ok(), `Failed to create variant ${i + 1}: ${createRes.status()}`).toBeTruthy()
        const body = (await createRes.json()) as { id?: string }
        expect(typeof body.id === 'string' && body.id.length > 0).toBeTruthy()
        variantIds.push(body.id as string)

        // Add price for each variant
        const priceRes = await apiRequest(request, 'POST', '/api/catalog/prices', {
          token,
          data: {
            productId,
            variantId: variantIds[i],
            priceKindId: priceKind.id,
            currencyCode: priceKind.currencyCode,
            minQuantity: 1,
            unitPriceGross: variantPrices[i],
          },
        })
        expect(priceRes.ok(), `Failed to create price for variant ${i + 1}: ${priceRes.status()}`).toBeTruthy()
      }

      // Verify all variants listed
      const listRes = await apiRequest(request, 'GET', `/api/catalog/variants?productId=${productId}&page=1&pageSize=50`, {
        token,
      })
      expect(listRes.ok(), `Failed to list variants: ${listRes.status()}`).toBeTruthy()
      const listBody = (await listRes.json()) as { items?: Array<{ id: string; sku?: string }> }
      const items = listBody.items ?? []

      const returnedIds = items.map((v) => v.id)
      for (const variantId of variantIds) {
        expect(returnedIds).toContain(variantId)
      }

      const returnedSkus = items.map((v) => v.sku)
      for (const sku of variantSkus) {
        expect(returnedSkus).toContain(sku)
      }
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })

  test('should edit second variant price and verify only that variant updated', async ({ request }) => {
    const suffix = Date.now()
    let token: string | null = null
    let productId: string | null = null

    try {
      token = await getAuthToken(request)
      const priceKind = await ensurePriceKindId(request, token)

      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-024 PriceEdit ${suffix}`,
        sku: `QA-CAT-024-PE-${suffix}`,
      })

      const variantIds: string[] = []
      const priceIds: string[] = []
      const originalPrices = [10.0, 20.0, 30.0]

      for (let i = 0; i < 3; i++) {
        const createRes = await apiRequest(request, 'POST', '/api/catalog/variants', {
          token,
          data: { productId, name: `Variant ${i + 1} ${suffix}`, sku: `QA-CAT-024-PE-V${i + 1}-${suffix}` },
        })
        expect(createRes.ok()).toBeTruthy()
        const body = (await createRes.json()) as { id?: string }
        variantIds.push(body.id as string)

        const priceRes = await apiRequest(request, 'POST', '/api/catalog/prices', {
          token,
          data: {
            productId,
            variantId: variantIds[i],
            priceKindId: priceKind.id,
            currencyCode: priceKind.currencyCode,
            minQuantity: 1,
            unitPriceGross: originalPrices[i],
          },
        })
        expect(priceRes.ok()).toBeTruthy()
        const priceBody = (await priceRes.json()) as { id?: string }
        priceIds.push(priceBody.id as string)
      }

      // Update second variant's price to 99.99
      const updateRes = await apiRequest(request, 'PUT', '/api/catalog/prices', {
        token,
        data: { id: priceIds[1], unitPriceGross: 99.99 },
      })
      expect(updateRes.ok(), `Failed to update price: ${updateRes.status()}`).toBeTruthy()

      // Verify prices — only second should be changed
      const listPrices = await apiRequest(
        request,
        'GET',
        `/api/catalog/prices?productId=${encodeURIComponent(productId)}&page=1&pageSize=50`,
        { token },
      )
      expect(listPrices.ok()).toBeTruthy()
      const pricesBody = (await listPrices.json()) as { items?: Array<Record<string, unknown>> }
      const prices = pricesBody.items ?? []

      for (const price of prices) {
        const gross = Number(price.unit_price_gross ?? price.unitPriceGross ?? NaN)
        if (price.id === priceIds[0]) {
          expect(Math.abs(gross - 10.0) < 0.01, 'First variant price should be unchanged').toBeTruthy()
        } else if (price.id === priceIds[1]) {
          expect(Math.abs(gross - 99.99) < 0.01, 'Second variant price should be 99.99').toBeTruthy()
        } else if (price.id === priceIds[2]) {
          expect(Math.abs(gross - 30.0) < 0.01, 'Third variant price should be unchanged').toBeTruthy()
        }
      }
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })

  test('should delete one variant and keep remaining variants intact', async ({ request }) => {
    const suffix = Date.now()
    let token: string | null = null
    let productId: string | null = null

    try {
      token = await getAuthToken(request)
      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-024 Delete ${suffix}`,
        sku: `QA-CAT-024-DEL-${suffix}`,
      })

      const variantIds: string[] = []

      for (let i = 0; i < 3; i++) {
        const createRes = await apiRequest(request, 'POST', '/api/catalog/variants', {
          token,
          data: { productId, name: `Variant Del ${i + 1} ${suffix}`, sku: `QA-CAT-024-DEL-V${i + 1}-${suffix}` },
        })
        expect(createRes.ok(), `Failed to create variant ${i + 1}: ${createRes.status()}`).toBeTruthy()
        const body = (await createRes.json()) as { id?: string }
        variantIds.push(body.id as string)
      }

      const deleteRes = await apiRequest(request, 'DELETE', `/api/catalog/variants?id=${encodeURIComponent(variantIds[1])}`, {
        token,
      })
      expect(deleteRes.ok(), `Failed to delete variant: ${deleteRes.status()}`).toBeTruthy()

      const listRes = await apiRequest(request, 'GET', `/api/catalog/variants?productId=${productId}&page=1&pageSize=50`, {
        token,
      })
      expect(listRes.ok(), `Failed to list variants after delete: ${listRes.status()}`).toBeTruthy()
      const listBody = (await listRes.json()) as { items?: Array<{ id: string }> }
      const items = listBody.items ?? []

      const remainingIds = items.map((v) => v.id)
      expect(remainingIds).toContain(variantIds[0])
      expect(remainingIds).not.toContain(variantIds[1])
      expect(remainingIds).toContain(variantIds[2])
    } finally {
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })
})
