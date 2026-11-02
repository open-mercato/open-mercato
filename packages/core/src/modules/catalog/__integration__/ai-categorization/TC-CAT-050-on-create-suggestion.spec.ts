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
  getPendingSuggestion,
  listSuggestions,
  readProductCategoryIds,
  setAiCategorizationEnabled,
} from './helpers'

/**
 * TC-CAT-050: on-create suggestions (spec 2026-10-28-catalog-ai-product-categorization.md,
 * Phase 4, step 16). With `autoSuggestOnCreate` on, creating a product with no
 * categories leads, once the persistent event and the categorization queue are
 * drained, to a pending `on_create` suggestion with no requesting user — and the
 * category is never applied, even in auto_apply mode. A product created with a
 * category, and a product created while the switch is off, get no suggestion.
 */

const EVENTS_QUEUE_NAME = 'events'

async function drainOnCreatePipeline(): Promise<void> {
  await drainIntegrationQueue(EVENTS_QUEUE_NAME)
  await drainIntegrationQueue(BULK_QUEUE_NAME)
}

test.describe.serial('TC-CAT-050: suggest categories for newly created products', () => {
  test.skip(process.env.OM_DECISION_PROVIDER !== 'fixture', 'requires the fixture decision provider')

  test('TC-CAT-050: an uncategorized new product gets a pending on_create suggestion that is never applied', async ({ request }) => {
    test.setTimeout(240_000)
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}${randomInt(1_000_000)}`
    const categoryIds: string[] = []
    const productIds: string[] = []

    try {
      await setAiCategorizationEnabled(request, token, true, {
        applyMode: 'auto_apply',
        autoApplyThreshold: 0.5,
        autoSuggestOnCreate: true,
      })

      const target = await createCategory(request, token, `QA 050 Target ${stamp}`)
      categoryIds.push(target)
      const existing = await createCategory(request, token, `QA 050 Existing ${stamp}`)
      categoryIds.push(existing)

      const emptyProduct = await createProduct(request, token, {
        title: `QA 050 Empty ${stamp}`,
        sku: `QA-050-E-${stamp}`,
        description: `Product tagged with category ${target} and no category yet.`,
      })
      productIds.push(emptyProduct)
      const categorizedProduct = await createProduct(request, token, {
        title: `QA 050 Categorized ${stamp}`,
        sku: `QA-050-C-${stamp}`,
        description: `Product tagged with category ${target} created with a category.`,
        categoryIds: [existing],
      })
      productIds.push(categorizedProduct)

      await expect.poll(async () => {
        await drainOnCreatePipeline()
        return getPendingSuggestion(request, token, emptyProduct)
      }, { message: 'on-create suggestion should appear for the uncategorized product', timeout: 180_000, intervals: [2_000] }).not.toBeNull()

      const suggestion = await getPendingSuggestion(request, token, emptyProduct)
      expect(suggestion?.categoryId).toBe(target)
      expect(suggestion?.status).toBe('pending')
      expect(await readProductCategoryIds(request, token, emptyProduct)).toEqual([])

      await drainOnCreatePipeline()
      expect(await getPendingSuggestion(request, token, categorizedProduct)).toBeNull()
      const autoApplied = await listSuggestions(request, token, { status: 'auto_applied' })
      expect(autoApplied.some((row) => row.productId === emptyProduct)).toBe(false)

      await setAiCategorizationEnabled(request, token, true, { autoSuggestOnCreate: false })
      const switchedOffProduct = await createProduct(request, token, {
        title: `QA 050 Switch Off ${stamp}`,
        sku: `QA-050-S-${stamp}`,
        description: `Product tagged with category ${target} created while the switch is off.`,
      })
      productIds.push(switchedOffProduct)
      await drainOnCreatePipeline()
      expect(await getPendingSuggestion(request, token, switchedOffProduct)).toBeNull()
    } finally {
      for (const productId of productIds) await deleteProduct(request, token, productId)
      for (const categoryId of categoryIds) await deleteCategory(request, token, categoryId)
      await setAiCategorizationEnabled(request, token, false)
    }
  })
})
