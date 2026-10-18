import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'

const DESCRIPTION =
  'Long enough description for the variant create undo integration test. This keeps server-side create validation satisfied.'

type Item = Record<string, unknown>

async function createEntity(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Item,
  label: string,
): Promise<{ id: string; response: Awaited<ReturnType<typeof apiRequest>> }> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  const body = await readJsonSafe<Item>(response)
  expect(response.ok(), `Failed to create ${label}: ${response.status()} ${JSON.stringify(body)}`).toBeTruthy()
  return { id: expectId(body?.id, `${label} id`), response }
}

async function listPrices(request: APIRequestContext, token: string, productId: string): Promise<Item[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/catalog/prices?productId=${encodeURIComponent(productId)}&page=1&pageSize=50`,
    { token },
  )
  expect(response.ok(), `GET prices failed: ${response.status()}`).toBeTruthy()
  const items = (await readJsonSafe<{ items?: Item[] }>(response))?.items ?? []
  return items
    .map((item) => ({ id: item.id, variantId: item.variant_id ?? item.variantId ?? null }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
}

async function readPriceRows(productId: string): Promise<Item[]> {
  return withClient(async (client) => {
    const result = await client.query<Item>(
      'select id, variant_id as "variantId" from catalog_product_variant_prices where product_id = $1 order by id',
      [productId],
    )
    return result.rows
  })
}

/**
 * TC-CAT-UNDO-005: undoing a variant create must remove the prices that were added to that
 * variant, instead of leaving them behind as product-wide prices with no variant.
 */
test.describe('TC-CAT-UNDO-005 variant create undo removes the variant prices', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('undo of a variant create removes its prices and keeps the sibling and product prices', async ({
    request,
  }) => {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    let token: string | null = null
    let productId: string | null = null
    let priceKindId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      priceKindId = (
        await createEntity(
          request,
          token,
          '/api/catalog/price-kinds',
          {
            title: `QA Variant Undo Kind ${stamp}`,
            code: `qa_var_undo_${stamp}`,
            displayMode: 'including-tax',
            currencyCode: 'USD',
          },
          'price kind',
        )
      ).id
      productId = (
        await createEntity(
          request,
          token,
          '/api/catalog/products',
          { title: `QA Variant Undo ${stamp}`, sku: `QA-VAR-UNDO-${stamp}`, description: DESCRIPTION },
          'product',
        )
      ).id
      const keptVariantId = (
        await createEntity(
          request,
          token,
          '/api/catalog/variants',
          { productId, name: 'Kept', sku: `QA-VAR-UNDO-${stamp}-A`, isDefault: true, isActive: true },
          'kept variant',
        )
      ).id
      const undoneVariant = await createEntity(
        request,
        token,
        '/api/catalog/variants',
        { productId, name: 'Undone', sku: `QA-VAR-UNDO-${stamp}-B`, isDefault: false, isActive: true },
        'undone variant',
      )
      const variantCreate = expectOperation(undoneVariant.response, 'catalog.variants.create')
      const priceInput = { productId, priceKindId, currencyCode: 'USD', minQuantity: 1 }
      const keptVariantPriceId = (
        await createEntity(
          request,
          token,
          '/api/catalog/prices',
          { ...priceInput, variantId: keptVariantId, unitPriceGross: 10 },
          'kept variant price',
        )
      ).id
      const productPriceId = (
        await createEntity(request, token, '/api/catalog/prices', { ...priceInput, unitPriceGross: 11 }, 'product price')
      ).id
      const undoneVariantPriceId = (
        await createEntity(
          request,
          token,
          '/api/catalog/prices',
          { ...priceInput, variantId: undoneVariant.id, unitPriceGross: 12 },
          'undone variant price',
        )
      ).id

      const beforeUndo = await listPrices(request, token, productId)
      expect(beforeUndo.map((price) => price.id).sort()).toEqual(
        [keptVariantPriceId, productPriceId, undoneVariantPriceId].sort(),
      )

      await undoOk(request, token, variantCreate.undoToken, 'catalog.variants.create undo')

      const expectedRemaining = [
        { id: keptVariantPriceId, variantId: keptVariantId },
        { id: productPriceId, variantId: null },
      ].sort((a, b) => a.id.localeCompare(b.id))
      expect(await readPriceRows(productId), 'stored prices after undo').toEqual(expectedRemaining)

      const afterUndo = await listPrices(request, token, productId)
      expect(
        afterUndo.find((price) => price.id === undoneVariantPriceId),
        'the undone variant price must not survive as a product-wide price',
      ).toBeUndefined()
      expect(afterUndo, 'listed prices after undo').toEqual(expectedRemaining)
    } finally {
      if (productId && token) {
        await apiRequest(request, 'DELETE', `/api/catalog/products?id=${encodeURIComponent(productId)}`, {
          token,
        }).catch(() => undefined)
      }
      if (priceKindId && token) {
        const cleanup = await apiRequest(
          request,
          'DELETE',
          `/api/catalog/price-kinds?id=${encodeURIComponent(priceKindId)}`,
          { token },
        )
        expect.soft([200, 404], 'price kind cleanup').toContain(cleanup.status())
      }
    }
  })
})
