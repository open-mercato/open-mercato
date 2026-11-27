import { randomInt } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectOperation, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'
import {
  acceptSuggestion,
  createCategory,
  createProduct,
  deleteCategory,
  deleteProduct,
  getPendingSuggestion,
  readProductCategoryIds,
  rejectSuggestion,
  setAiCategorizationEnabled,
  suggestCategory,
  type SuggestionDto,
} from './helpers'

/**
 * TC-CAT-043..047: catalog AI category suggestions (spec
 * 2026-10-28-catalog-ai-product-categorization.md, Phase 1).
 *
 * Runs against the fixture decision provider (OM_DECISION_PROVIDER=fixture):
 * it picks the first option, in option order, whose key appears as a whole
 * word in the serialized `state`, with probability 1. A product's
 * `description` is therefore used to steer the fixture onto a specific
 * category id, or onto the `__none`/`__here` sentinel.
 *
 * All five cases share one tenant-level setting
 * (catalog.ai_categorization.enabled), so they run in one serial file instead
 * of five independent ones — toggling that setting from a second file running
 * concurrently would race this suite.
 */

test.describe.serial('TC-CAT-043..047: catalog AI category suggestions', () => {
  test.skip(process.env.OM_DECISION_PROVIDER !== 'fixture', 'requires the fixture decision provider')

  let token: string
  const stamp = `${Date.now()}${randomInt(1_000_000)}`
  const createdCategoryIds: string[] = []
  const createdProductIds: string[] = []

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
    await setAiCategorizationEnabled(request, token, true)
  })

  test.afterAll(async ({ request }) => {
    for (const productId of createdProductIds) await deleteProduct(request, token, productId)
    for (const categoryId of createdCategoryIds) await deleteCategory(request, token, categoryId)
    await setAiCategorizationEnabled(request, token, false)
  })

  test('TC-CAT-043: empty product -> suggest -> accept -> undo restores pending with no category', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const category = await createCategory(request, token, `QA 043 Category ${stamp}`)
    createdCategoryIds.push(category)
    const productId = await createProduct(request, token, {
      title: `QA 043 Product ${stamp}`,
      sku: `QA-043-${stamp}`,
      description: `Product tagged with category ${category} for AI categorization QA.`,
    })
    createdProductIds.push(productId)

    const { status, body } = await suggestCategory(request, token, productId)
    expect(status, 'suggest should return 201').toBe(201)
    const suggestion = body.suggestion as SuggestionDto
    expect(suggestion.outcome).toBe('suggested')
    expect(suggestion.categoryId).toBe(category)
    expect(suggestion.status).toBe('pending')

    const acceptRes = await acceptSuggestion(request, token, suggestion.id)
    expect(acceptRes.status(), `accept failed: ${await acceptRes.text()}`).toBe(200)
    const acceptBody = (await acceptRes.json()) as { product: { categoryIds: string[] } }
    expect(acceptBody.product.categoryIds).toEqual([category])
    expect(await readProductCategoryIds(request, token, productId)).toEqual([category])

    const acceptOp = expectOperation(acceptRes, 'catalog.category_suggestions.accept')
    await undoOk(request, token, acceptOp.undoToken, 'catalog.category_suggestions.accept undo')

    expect(await readProductCategoryIds(request, token, productId), 'undo should clear categoryIds').toEqual([])
    const restored = await getPendingSuggestion(request, token, productId)
    expect(restored?.id, 'undo should restore the suggestion to pending').toBe(suggestion.id)
    expect(restored?.status).toBe('pending')
  })

  test('TC-CAT-044: a product with existing categories appends the suggestion last, or first with makeMain', async ({ request }) => {
    const existing = await createCategory(request, token, `QA 044 Existing ${stamp}`)
    const target = await createCategory(request, token, `QA 044 Target ${stamp}`)
    createdCategoryIds.push(existing, target)

    const productAppend = await createProduct(request, token, {
      title: `QA 044 Append Product ${stamp}`,
      sku: `QA-044-APPEND-${stamp}`,
      description: `References category ${target} for AI categorization QA.`,
      categoryIds: [existing],
    })
    createdProductIds.push(productAppend)
    const { body: appendBody } = await suggestCategory(request, token, productAppend)
    const appendSuggestion = appendBody.suggestion as SuggestionDto
    expect(appendSuggestion.categoryId).toBe(target)
    const appendAccept = await acceptSuggestion(request, token, appendSuggestion.id)
    expect(appendAccept.status()).toBe(200)
    expect(await readProductCategoryIds(request, token, productAppend)).toEqual([existing, target])

    const existingMain = await createCategory(request, token, `QA 044 Existing Main ${stamp}`)
    createdCategoryIds.push(existingMain)
    const productMakeMain = await createProduct(request, token, {
      title: `QA 044 MakeMain Product ${stamp}`,
      sku: `QA-044-MAKEMAIN-${stamp}`,
      description: `References category ${target} for AI categorization QA.`,
      categoryIds: [existingMain],
    })
    createdProductIds.push(productMakeMain)
    const { body: mainBody } = await suggestCategory(request, token, productMakeMain)
    const mainSuggestion = mainBody.suggestion as SuggestionDto
    expect(mainSuggestion.categoryId).toBe(target)
    const mainAccept = await acceptSuggestion(request, token, mainSuggestion.id, { makeMain: true })
    expect(mainAccept.status()).toBe(200)
    expect(await readProductCategoryIds(request, token, productMakeMain)).toEqual([target, existingMain])
  })

  test('TC-CAT-045: a description with only __none produces no_match; a root id plus __here suggests the root', async ({ request }) => {
    const unrelatedRoot = await createCategory(request, token, `QA 045 Unrelated Root ${stamp}`)
    createdCategoryIds.push(unrelatedRoot)
    const noMatchProduct = await createProduct(request, token, {
      title: `QA 045 NoMatch Product ${stamp}`,
      sku: `QA-045-NOMATCH-${stamp}`,
      description: 'This description only contains the sentinel token __none and no category id.',
    })
    createdProductIds.push(noMatchProduct)
    const { status: noMatchStatus, body: noMatchBody } = await suggestCategory(request, token, noMatchProduct)
    expect(noMatchStatus).toBe(201)
    expect((noMatchBody.suggestion as SuggestionDto).outcome).toBe('no_match')
    expect((noMatchBody.suggestion as SuggestionDto).categoryId).toBeNull()

    const root = await createCategory(request, token, `QA 045 Root ${stamp}`)
    createdCategoryIds.push(root)
    const child = await createCategory(request, token, `QA 045 Child ${stamp}`, { parentId: root })
    createdCategoryIds.push(child)

    const hereProduct = await createProduct(request, token, {
      title: `QA 045 Here Product ${stamp}`,
      sku: `QA-045-HERE-${stamp}`,
      description: `References root category ${root} and the stop token __here for AI categorization QA.`,
    })
    createdProductIds.push(hereProduct)
    const { status: hereStatus, body: hereBody } = await suggestCategory(request, token, hereProduct)
    expect(hereStatus).toBe(201)
    const hereSuggestion = hereBody.suggestion as SuggestionDto
    expect(hereSuggestion.outcome).toBe('suggested')
    expect(hereSuggestion.categoryId).toBe(root)
    expect(hereSuggestion.categoryPathIds).toEqual([root])
  })

  test('TC-CAT-046: reject; a second accept on the same suggestion is 409; accepting a soft-deleted category is 422', async ({ request }) => {
    const rejectCategory = await createCategory(request, token, `QA 046 Reject Category ${stamp}`)
    createdCategoryIds.push(rejectCategory)
    const rejectProduct = await createProduct(request, token, {
      title: `QA 046 Reject Product ${stamp}`,
      sku: `QA-046-REJECT-${stamp}`,
      description: `References category ${rejectCategory} for AI categorization QA.`,
    })
    createdProductIds.push(rejectProduct)
    const { body: rejectSuggestBody } = await suggestCategory(request, token, rejectProduct)
    const rejectableSuggestion = rejectSuggestBody.suggestion as SuggestionDto

    const rejectRes = await rejectSuggestion(request, token, rejectableSuggestion.id)
    expect(rejectRes.status(), `reject failed: ${await rejectRes.text()}`).toBe(200)

    const secondAccept = await acceptSuggestion(request, token, rejectableSuggestion.id)
    expect(secondAccept.status(), 'accepting an already-reviewed suggestion must be 409').toBe(409)
    const secondAcceptBody = await secondAccept.json()
    expect(secondAcceptBody.code).toBe('suggestion_not_pending')

    const deletedCategory = await createCategory(request, token, `QA 046 Deleted Category ${stamp}`)
    createdCategoryIds.push(deletedCategory)
    const deletedCategoryProduct = await createProduct(request, token, {
      title: `QA 046 Deleted Category Product ${stamp}`,
      sku: `QA-046-DELETED-${stamp}`,
      description: `References category ${deletedCategory} for AI categorization QA.`,
    })
    createdProductIds.push(deletedCategoryProduct)
    const { body: deletedCategorySuggestBody } = await suggestCategory(request, token, deletedCategoryProduct)
    const deletedCategorySuggestion = deletedCategorySuggestBody.suggestion as SuggestionDto
    await deleteCategory(request, token, deletedCategory)

    const acceptAfterDelete = await acceptSuggestion(request, token, deletedCategorySuggestion.id)
    expect(acceptAfterDelete.status(), 'accepting a soft-deleted category must be 422').toBe(422)
    const acceptAfterDeleteBody = await acceptAfterDelete.json()
    expect(acceptAfterDeleteBody.code).toBe('category_unavailable')
  })

  test('TC-CAT-047: the suggest route answers 409 when the tenant disables AI categorization', async ({ request }) => {
    const disabledCategory = await createCategory(request, token, `QA 047 Category ${stamp}`)
    createdCategoryIds.push(disabledCategory)
    const disabledProduct = await createProduct(request, token, {
      title: `QA 047 Product ${stamp}`,
      sku: `QA-047-${stamp}`,
      description: `References category ${disabledCategory} for AI categorization QA.`,
    })
    createdProductIds.push(disabledProduct)

    await setAiCategorizationEnabled(request, token, false)
    try {
      const { status, body } = await suggestCategory(request, token, disabledProduct)
      expect(status).toBe(409)
      expect(body.code).toBe('ai_categorization_unavailable')
    } finally {
      await setAiCategorizationEnabled(request, token, true)
    }
  })
})
