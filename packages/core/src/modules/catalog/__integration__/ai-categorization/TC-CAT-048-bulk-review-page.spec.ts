import { randomInt } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  acceptSuggestion,
  BULK_QUEUE_NAME,
  createCategory,
  createProduct,
  deleteCategory,
  deleteProduct,
  listSuggestions,
  readProductCategoryIds,
  setAiCategorizationEnabled,
  startBulkCategorization,
} from './helpers'

/**
 * TC-CAT-048: bulk AI categorization -> review list -> bulk accept (spec
 * 2026-10-28-catalog-ai-product-categorization.md, Phase 2, step 14).
 *
 * Uses the fixture decision provider, which picks the first option whose key
 * appears as a whole word in the serialized product state. Each product
 * description carries exactly one category id, so every suggestion is
 * deterministic. The review page issues one accept call per selected row, so
 * the test does the same through the API.
 */

test.describe.serial('TC-CAT-048: bulk run, review list and bulk accept', () => {
  test.skip(process.env.OM_DECISION_PROVIDER !== 'fixture', 'requires the fixture decision provider')

  test('TC-CAT-048: bulk run produces pending suggestions, the review list shows them, bulk accept assigns categories', async ({ request }) => {
    test.setTimeout(240_000)
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}${randomInt(1_000_000)}`
    const categoryIds: string[] = []
    const productIds: string[] = []

    try {
      await setAiCategorizationEnabled(request, token, true)

      const categoryA = await createCategory(request, token, `QA 048 Category A ${stamp}`)
      categoryIds.push(categoryA)
      const categoryB = await createCategory(request, token, `QA 048 Category B ${stamp}`)
      categoryIds.push(categoryB)

      const productA = await createProduct(request, token, {
        title: `QA 048 Product A ${stamp}`,
        sku: `QA-048-A-${stamp}`,
        description: `Product tagged with category ${categoryA} for bulk review QA.`,
      })
      productIds.push(productA)
      const productB = await createProduct(request, token, {
        title: `QA 048 Product B ${stamp}`,
        sku: `QA-048-B-${stamp}`,
        description: `Product tagged with category ${categoryB} for bulk review QA.`,
      })
      productIds.push(productB)
      const productHidden = await createProduct(request, token, {
        title: `QA 048 Product Hidden ${stamp}`,
        sku: `QA-048-H-${stamp}`,
        description: `Product tagged with category ${categoryA} that is deleted before review.`,
      })
      productIds.push(productHidden)

      const started = await startBulkCategorization(request, token, [productA, productB, productHidden])
      expect(started.status, 'bulk start should be accepted').toBe(202)
      expect(started.progressJobId, 'bulk start should return a progress job id').toBeTruthy()

      await expect.poll(async () => {
        await drainIntegrationQueue(BULK_QUEUE_NAME)
        const rows = await listSuggestions(request, token, { status: 'pending' })
        const ids = new Set(rows.map((row) => row.productId))
        return [productA, productB, productHidden].every((id) => ids.has(id))
      }, { message: 'bulk worker should write a pending suggestion per product', timeout: 180_000, intervals: [2_000] }).toBe(true)

      await deleteProduct(request, token, productHidden)
      productIds.splice(productIds.indexOf(productHidden), 1)

      const reviewList = await listSuggestions(request, token, { status: 'pending' })
      const reviewByProduct = new Map(reviewList.map((row) => [row.productId, row]))
      expect(reviewByProduct.has(productHidden), 'suggestions of soft-deleted products are hidden').toBe(false)
      const suggestionA = reviewByProduct.get(productA)
      const suggestionB = reviewByProduct.get(productB)
      expect(suggestionA?.categoryId).toBe(categoryA)
      expect(suggestionA?.categoryLive).toBe(true)
      expect(suggestionB?.categoryId).toBe(categoryB)
      expect(suggestionB?.categoryLive).toBe(true)

      for (const suggestion of [suggestionA, suggestionB]) {
        const accept = await acceptSuggestion(request, token, suggestion!.id)
        expect(accept.status(), `accept failed: ${await accept.text()}`).toBe(200)
      }

      expect(await readProductCategoryIds(request, token, productA)).toEqual([categoryA])
      expect(await readProductCategoryIds(request, token, productB)).toEqual([categoryB])

      const stillPending = await listSuggestions(request, token, { status: 'pending' })
      const pendingProducts = new Set(stillPending.map((row) => row.productId))
      expect(pendingProducts.has(productA)).toBe(false)
      expect(pendingProducts.has(productB)).toBe(false)

      const accepted = await listSuggestions(request, token, { status: 'accepted' })
      const acceptedProducts = new Set(accepted.map((row) => row.productId))
      expect(acceptedProducts.has(productA)).toBe(true)
      expect(acceptedProducts.has(productB)).toBe(true)
    } finally {
      for (const productId of productIds) await deleteProduct(request, token, productId)
      for (const categoryId of categoryIds) await deleteCategory(request, token, categoryId)
      await setAiCategorizationEnabled(request, token, false)
    }
  })
})
