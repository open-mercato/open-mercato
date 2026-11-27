import { randomInt } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  BULK_QUEUE_NAME,
  createCategory,
  createProduct,
  deleteCategory,
  deleteProduct,
  listSuggestions,
  readProductCategoryIds,
  setAiCategorizationEnabled,
  startBulkCategorization,
  suggestCategory,
} from './helpers'

/**
 * TC-CAT-049: auto-apply (spec 2026-10-28-catalog-ai-product-categorization.md,
 * Phase 3, step 15). With applyMode `auto_apply`, a user-started run applies a
 * suggestion whose confidence reaches the threshold when the product has no
 * category (fixture provider gives p = 1), and leaves a product that already
 * has a category pending. Covers the single-product route and the bulk worker.
 */

test.describe.serial('TC-CAT-049: auto-apply above the confidence threshold', () => {
  test.skip(process.env.OM_DECISION_PROVIDER !== 'fixture', 'requires the fixture decision provider')

  test('TC-CAT-049: empty products are auto-applied, categorized products stay pending', async ({ request }) => {
    test.setTimeout(240_000)
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}${randomInt(1_000_000)}`
    const categoryIds: string[] = []
    const productIds: string[] = []

    try {
      await setAiCategorizationEnabled(request, token, true, { applyMode: 'auto_apply', autoApplyThreshold: 0.85 })

      const target = await createCategory(request, token, `QA 049 Target ${stamp}`)
      categoryIds.push(target)
      const existing = await createCategory(request, token, `QA 049 Existing ${stamp}`)
      categoryIds.push(existing)

      const emptyProduct = await createProduct(request, token, {
        title: `QA 049 Empty ${stamp}`,
        sku: `QA-049-E-${stamp}`,
        description: `Product tagged with category ${target} and no category yet.`,
      })
      productIds.push(emptyProduct)
      const categorizedProduct = await createProduct(request, token, {
        title: `QA 049 Categorized ${stamp}`,
        sku: `QA-049-C-${stamp}`,
        description: `Product tagged with category ${target} that already has a category.`,
        categoryIds: [existing],
      })
      productIds.push(categorizedProduct)
      const bulkProduct = await createProduct(request, token, {
        title: `QA 049 Bulk ${stamp}`,
        sku: `QA-049-B-${stamp}`,
        description: `Product tagged with category ${target} for the bulk worker.`,
      })
      productIds.push(bulkProduct)

      const emptyRun = await suggestCategory(request, token, emptyProduct)
      expect(emptyRun.status).toBe(201)
      expect(emptyRun.body.suggestion?.categoryId).toBe(target)
      expect(emptyRun.body.suggestion?.status).toBe('auto_applied')
      expect(await readProductCategoryIds(request, token, emptyProduct)).toEqual([target])

      const categorizedRun = await suggestCategory(request, token, categorizedProduct)
      expect(categorizedRun.status).toBe(201)
      expect(categorizedRun.body.suggestion?.status).toBe('pending')
      expect(await readProductCategoryIds(request, token, categorizedProduct)).toEqual([existing])

      const started = await startBulkCategorization(request, token, [bulkProduct])
      expect(started.status, 'bulk start should be accepted').toBe(202)
      await expect.poll(async () => {
        await drainIntegrationQueue(BULK_QUEUE_NAME)
        const rows = await listSuggestions(request, token, { status: 'auto_applied' })
        return rows.some((row) => row.productId === bulkProduct)
      }, { message: 'bulk worker should auto-apply the empty product', timeout: 180_000, intervals: [2_000] }).toBe(true)
      expect(await readProductCategoryIds(request, token, bulkProduct)).toEqual([target])

      await setAiCategorizationEnabled(request, token, true, { applyMode: 'suggest' })
      const productSuggestOnly = await createProduct(request, token, {
        title: `QA 049 Suggest Only ${stamp}`,
        sku: `QA-049-S-${stamp}`,
        description: `Product tagged with category ${target} in suggest mode.`,
      })
      productIds.push(productSuggestOnly)
      const suggestOnlyRun = await suggestCategory(request, token, productSuggestOnly)
      expect(suggestOnlyRun.body.suggestion?.status).toBe('pending')
      expect(await readProductCategoryIds(request, token, productSuggestOnly)).toEqual([])
    } finally {
      for (const productId of productIds) await deleteProduct(request, token, productId)
      for (const categoryId of categoryIds) await deleteCategory(request, token, categoryId)
      await setAiCategorizationEnabled(request, token, false)
    }
  })
})
