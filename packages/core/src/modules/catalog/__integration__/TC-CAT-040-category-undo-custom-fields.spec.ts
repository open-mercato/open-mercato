import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCategoryFixture,
  deleteCatalogCategoryIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  expectOperation,
  redoOk,
  skipIfUndoTestsDisabled,
  undoByToken,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'

const CATEGORY_ENTITY_ID = 'catalog:catalog_product_category'
const CATEGORIES_PATH = '/api/catalog/categories'

/**
 * TC-CAT-040
 *
 * Undoing a category update must put the category's custom field values back,
 * not only its own columns. Covers a single-value text field and a multi-select
 * field through update → undo → redo → undo, the case where the update is the
 * first write of the custom fields (undo clears them), an update that moves
 * the category to another parent while clearing its custom fields, integer,
 * float, boolean and date fields with one value left unchanged, and an older
 * update that cannot be undone while a later one is still in place.
 *
 * Self-contained: creates its own field definitions and categories and removes
 * them in finally.
 */

async function createCategoryDefinition(
  request: APIRequestContext,
  token: string,
  data: { key: string; kind: string; configJson: Record<string, unknown> },
): Promise<void> {
  const response = await apiRequest(request, 'POST', '/api/entities/definitions', {
    token,
    data: { entityId: CATEGORY_ENTITY_ID, ...data },
  })
  expect(response.status(), `POST /api/entities/definitions should create ${data.key}`).toBe(200)
}

async function deleteCategoryDefinition(
  request: APIRequestContext,
  token: string | null,
  key: string,
): Promise<void> {
  if (!token) return
  try {
    await apiRequest(request, 'DELETE', '/api/entities/definitions', {
      token,
      data: { entityId: CATEGORY_ENTITY_ID, key },
    })
  } catch {
    return
  }
}

async function createCategoryDefinitions(
  request: APIRequestContext,
  token: string,
  input: { textKey: string; multiKey: string; stamp: string },
): Promise<void> {
  await createCategoryDefinition(request, token, {
    key: input.textKey,
    kind: 'text',
    configJson: { label: `QA Season ${input.stamp}` },
  })
  await createCategoryDefinition(request, token, {
    key: input.multiKey,
    kind: 'select',
    configJson: { label: `QA Channels ${input.stamp}`, multi: true, options: ['web', 'store', 'outlet'] },
  })
}

async function readCategory(
  request: APIRequestContext,
  token: string,
  categoryId: string,
): Promise<Record<string, unknown>> {
  const response = await apiRequest(request, 'GET', `${CATEGORIES_PATH}?ids=${encodeURIComponent(categoryId)}`, {
    token,
  })
  expect(response.ok(), `GET ${CATEGORIES_PATH} failed: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
  const item = (body?.items ?? []).find((entry) => entry.id === categoryId)
  expect(item, 'category should be returned by the ids query').toBeTruthy()
  return item as Record<string, unknown>
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry)).sort((left, right) => left.localeCompare(right))
  if (value === null || value === undefined || value === '') return []
  return [String(value)]
}

test.describe('TC-CAT-040: category update undo restores custom fields', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('update → undo → redo → undo round-trips text and multi-select values', async ({ request }) => {
    const stamp = `${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    const textKey = `qa_cat_text_${stamp}`
    const multiKey = `qa_cat_multi_${stamp}`
    const originalName = `QA Undo CF Category ${stamp}`
    const renamedName = `QA Undo CF Category Renamed ${stamp}`

    let token: string | null = null
    let categoryId: string | null = null

    try {
      token = await getAuthToken(request)
      await createCategoryDefinitions(request, token, { textKey, multiKey, stamp })

      const createRes = await apiRequest(request, 'POST', CATEGORIES_PATH, {
        token,
        data: {
          name: originalName,
          customFields: { [textKey]: 'winter', [multiKey]: ['web', 'store'] },
        },
      })
      expect(createRes.status(), 'category create status').toBe(201)
      categoryId = expectId((await readJsonSafe<Record<string, unknown>>(createRes))?.id, 'category id')

      const created = await readCategory(request, token, categoryId)
      expect(created[`cf_${textKey}`]).toBe('winter')
      expect(asStringArray(created[`cf_${multiKey}`])).toEqual(['store', 'web'])

      const updateRes = await apiRequest(request, 'PUT', CATEGORIES_PATH, {
        token,
        data: {
          id: categoryId,
          name: renamedName,
          customFields: { [textKey]: 'summer', [multiKey]: ['outlet'] },
        },
      })
      expect(updateRes.ok(), `category update failed: ${updateRes.status()}`).toBeTruthy()
      const updateOp = expectOperation(updateRes, 'catalog.categories.update')

      const updated = await readCategory(request, token, categoryId)
      expect(updated.name).toBe(renamedName)
      expect(updated[`cf_${textKey}`]).toBe('summer')
      expect(asStringArray(updated[`cf_${multiKey}`])).toEqual(['outlet'])

      await undoOk(request, token, updateOp.undoToken, 'category update undo')
      const undone = await readCategory(request, token, categoryId)
      expect(undone.name, 'undo restores the name').toBe(originalName)
      expect(undone[`cf_${textKey}`], 'undo restores the text custom field').toBe('winter')
      expect(asStringArray(undone[`cf_${multiKey}`]), 'undo restores the multi-select custom field').toEqual([
        'store',
        'web',
      ])

      const redone = await redoOk(request, token, updateOp.logId, 'category update redo')
      const afterRedo = await readCategory(request, token, categoryId)
      expect(afterRedo.name, 'redo re-applies the name').toBe(renamedName)
      expect(afterRedo[`cf_${textKey}`], 'redo re-applies the text custom field').toBe('summer')
      expect(asStringArray(afterRedo[`cf_${multiKey}`]), 'redo re-applies the multi-select custom field').toEqual([
        'outlet',
      ])

      const redoUndoToken = expectId(redone.undoToken, 'redo issues a new undo token')
      await undoOk(request, token, redoUndoToken, 'category update undo after redo')
      const undoneAgain = await readCategory(request, token, categoryId)
      expect(undoneAgain.name, 'second undo restores the name').toBe(originalName)
      expect(undoneAgain[`cf_${textKey}`], 'second undo restores the text custom field').toBe('winter')
      expect(
        asStringArray(undoneAgain[`cf_${multiKey}`]),
        'second undo restores the multi-select custom field',
      ).toEqual(['store', 'web'])
    } finally {
      await deleteCatalogCategoryIfExists(request, token, categoryId)
      await deleteCategoryDefinition(request, token, textKey)
      await deleteCategoryDefinition(request, token, multiKey)
    }
  })

  test('undo clears custom fields the update set for the first time', async ({ request }) => {
    const stamp = `${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    const textKey = `qa_cat_text_${stamp}`
    const multiKey = `qa_cat_multi_${stamp}`

    let token: string | null = null
    let categoryId: string | null = null

    try {
      token = await getAuthToken(request)
      await createCategoryDefinitions(request, token, { textKey, multiKey, stamp })

      categoryId = await createCategoryFixture(request, token, { name: `QA Undo CF Blank Category ${stamp}` })

      const updateRes = await apiRequest(request, 'PUT', CATEGORIES_PATH, {
        token,
        data: {
          id: categoryId,
          customFields: { [textKey]: 'summer', [multiKey]: ['outlet', 'web'] },
        },
      })
      expect(updateRes.ok(), `category update failed: ${updateRes.status()}`).toBeTruthy()
      const updateOp = expectOperation(updateRes, 'catalog.categories.update')

      const updated = await readCategory(request, token, categoryId)
      expect(updated[`cf_${textKey}`]).toBe('summer')
      expect(asStringArray(updated[`cf_${multiKey}`])).toEqual(['outlet', 'web'])

      await undoOk(request, token, updateOp.undoToken, 'category update undo')
      const undone = await readCategory(request, token, categoryId)
      expect(undone[`cf_${textKey}`] ?? null, 'undo clears the text custom field').toBeNull()
      expect(asStringArray(undone[`cf_${multiKey}`]), 'undo clears the multi-select custom field').toEqual([])
    } finally {
      await deleteCatalogCategoryIfExists(request, token, categoryId)
      await deleteCategoryDefinition(request, token, textKey)
      await deleteCategoryDefinition(request, token, multiKey)
    }
  })

  test('undo restores the parent and the custom fields one update changed together', async ({ request }) => {
    const stamp = `${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    const textKey = `qa_cat_text_${stamp}`
    const multiKey = `qa_cat_multi_${stamp}`

    let token: string | null = null
    let firstParentId: string | null = null
    let secondParentId: string | null = null
    let categoryId: string | null = null

    try {
      token = await getAuthToken(request)
      await createCategoryDefinitions(request, token, { textKey, multiKey, stamp })
      firstParentId = await createCategoryFixture(request, token, { name: `QA Undo CF Parent A ${stamp}` })
      secondParentId = await createCategoryFixture(request, token, { name: `QA Undo CF Parent B ${stamp}` })

      const createRes = await apiRequest(request, 'POST', CATEGORIES_PATH, {
        token,
        data: {
          name: `QA Undo CF Child ${stamp}`,
          parentId: firstParentId,
          customFields: { [textKey]: 'winter', [multiKey]: ['store', 'web'] },
        },
      })
      expect(createRes.status(), 'category create status').toBe(201)
      categoryId = expectId((await readJsonSafe<Record<string, unknown>>(createRes))?.id, 'category id')

      const updateRes = await apiRequest(request, 'PUT', CATEGORIES_PATH, {
        token,
        data: {
          id: categoryId,
          parentId: secondParentId,
          customFields: { [textKey]: null, [multiKey]: [] },
        },
      })
      expect(updateRes.ok(), `category update failed: ${updateRes.status()}`).toBeTruthy()
      const updateOp = expectOperation(updateRes, 'catalog.categories.update')

      const updated = await readCategory(request, token, categoryId)
      expect(updated.parentId).toBe(secondParentId)
      expect(updated[`cf_${textKey}`] ?? null).toBeNull()
      expect(asStringArray(updated[`cf_${multiKey}`])).toEqual([])

      await undoOk(request, token, updateOp.undoToken, 'category move undo')
      const undone = await readCategory(request, token, categoryId)
      expect(undone.parentId, 'undo restores the parent').toBe(firstParentId)
      expect(undone[`cf_${textKey}`], 'undo restores the cleared text custom field').toBe('winter')
      expect(
        asStringArray(undone[`cf_${multiKey}`]),
        'undo restores the cleared multi-select custom field',
      ).toEqual(['store', 'web'])
    } finally {
      await deleteCatalogCategoryIfExists(request, token, categoryId)
      await deleteCatalogCategoryIfExists(request, token, firstParentId)
      await deleteCatalogCategoryIfExists(request, token, secondParentId)
      await deleteCategoryDefinition(request, token, textKey)
      await deleteCategoryDefinition(request, token, multiKey)
    }
  })

  test('undo restores integer, float, boolean and date values and keeps an unchanged one', async ({ request }) => {
    const stamp = `${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    const rankKey = `qa_cat_rank_${stamp}`
    const weightKey = `qa_cat_weight_${stamp}`
    const featuredKey = `qa_cat_featured_${stamp}`
    const launchKey = `qa_cat_launch_${stamp}`
    const keys = [rankKey, weightKey, featuredKey, launchKey]

    let token: string | null = null
    let categoryId: string | null = null

    try {
      token = await getAuthToken(request)
      await createCategoryDefinition(request, token, { key: rankKey, kind: 'integer', configJson: { label: `QA Rank ${stamp}` } })
      await createCategoryDefinition(request, token, { key: weightKey, kind: 'float', configJson: { label: `QA Weight ${stamp}` } })
      await createCategoryDefinition(request, token, { key: featuredKey, kind: 'boolean', configJson: { label: `QA Featured ${stamp}` } })
      await createCategoryDefinition(request, token, { key: launchKey, kind: 'date', configJson: { label: `QA Launch ${stamp}` } })

      const createRes = await apiRequest(request, 'POST', CATEGORIES_PATH, {
        token,
        data: {
          name: `QA Undo CF Typed Category ${stamp}`,
          description: 'Original description',
          customFields: { [rankKey]: 3, [weightKey]: 1.5, [featuredKey]: true, [launchKey]: '2026-03-01' },
        },
      })
      expect(createRes.status(), 'category create status').toBe(201)
      categoryId = expectId((await readJsonSafe<Record<string, unknown>>(createRes))?.id, 'category id')
      const created = await readCategory(request, token, categoryId)
      expect(created[`cf_${launchKey}`], 'the date field is stored on create').toBeTruthy()

      const updateRes = await apiRequest(request, 'PUT', CATEGORIES_PATH, {
        token,
        data: {
          id: categoryId,
          description: 'Edited description',
          customFields: { [rankKey]: 4, [featuredKey]: false, [launchKey]: null },
        },
      })
      expect(updateRes.ok(), `category update failed: ${updateRes.status()}`).toBeTruthy()
      const updateOp = expectOperation(updateRes, 'catalog.categories.update')

      const updated = await readCategory(request, token, categoryId)
      expect(updated.description).toBe('Edited description')
      expect(updated[`cf_${rankKey}`]).toBe(4)
      expect(updated[`cf_${weightKey}`], 'the update leaves the float field as it was').toBe(1.5)
      expect(updated[`cf_${featuredKey}`]).toBe(false)
      expect(updated[`cf_${launchKey}`] ?? null).toBeNull()

      await undoOk(request, token, updateOp.undoToken, 'typed category update undo')
      const undone = await readCategory(request, token, categoryId)
      expect(undone.description, 'undo restores the description').toBe('Original description')
      expect(undone[`cf_${rankKey}`], 'undo restores the integer field').toBe(3)
      expect(undone[`cf_${weightKey}`], 'undo keeps the unchanged float field').toBe(1.5)
      expect(undone[`cf_${featuredKey}`], 'undo restores the boolean field').toBe(true)
      expect(undone[`cf_${launchKey}`], 'undo restores the cleared date field').toEqual(created[`cf_${launchKey}`])
    } finally {
      await deleteCatalogCategoryIfExists(request, token, categoryId)
      for (const key of keys) await deleteCategoryDefinition(request, token, key)
    }
  })

  test('an older update cannot be undone past a later one, and undoing both in order restores the custom fields', async ({ request }) => {
    const stamp = `${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    const textKey = `qa_cat_text_${stamp}`
    const multiKey = `qa_cat_multi_${stamp}`
    const originalName = `QA Undo CF Stale Category ${stamp}`
    const firstName = `QA Undo CF Stale Category First ${stamp}`

    let token: string | null = null
    let categoryId: string | null = null

    try {
      token = await getAuthToken(request)
      await createCategoryDefinitions(request, token, { textKey, multiKey, stamp })

      const createRes = await apiRequest(request, 'POST', CATEGORIES_PATH, {
        token,
        data: { name: originalName, customFields: { [textKey]: 'winter', [multiKey]: ['web'] } },
      })
      expect(createRes.status(), 'category create status').toBe(201)
      categoryId = expectId((await readJsonSafe<Record<string, unknown>>(createRes))?.id, 'category id')

      const firstRes = await apiRequest(request, 'PUT', CATEGORIES_PATH, {
        token,
        data: { id: categoryId, name: firstName, customFields: { [textKey]: 'summer' } },
      })
      expect(firstRes.ok(), `first update failed: ${firstRes.status()}`).toBeTruthy()
      const firstOp = expectOperation(firstRes, 'catalog.categories.update')

      const secondRes = await apiRequest(request, 'PUT', CATEGORIES_PATH, {
        token,
        data: { id: categoryId, description: 'Second edit', customFields: { [textKey]: 'autumn', [multiKey]: ['store'] } },
      })
      expect(secondRes.ok(), `second update failed: ${secondRes.status()}`).toBeTruthy()
      const secondOp = expectOperation(secondRes, 'catalog.categories.update')

      const staleRes = await undoByToken(request, token, firstOp.undoToken)
      expect(staleRes.status(), 'undo of the older update is refused while the later one is in place').toBe(400)
      const stillSecond = await readCategory(request, token, categoryId)
      expect(stillSecond.name).toBe(firstName)
      expect(stillSecond.description).toBe('Second edit')
      expect(stillSecond[`cf_${textKey}`], 'the refused undo leaves the later custom field value').toBe('autumn')
      expect(asStringArray(stillSecond[`cf_${multiKey}`])).toEqual(['store'])

      await undoOk(request, token, secondOp.undoToken, 'second update undo')
      const afterSecondUndo = await readCategory(request, token, categoryId)
      expect(afterSecondUndo.name).toBe(firstName)
      expect(afterSecondUndo.description ?? null).toBeNull()
      expect(afterSecondUndo[`cf_${textKey}`], 'undo of the later update restores the first update value').toBe('summer')
      expect(asStringArray(afterSecondUndo[`cf_${multiKey}`])).toEqual(['web'])

      await undoOk(request, token, firstOp.undoToken, 'first update undo')
      const afterFirstUndo = await readCategory(request, token, categoryId)
      expect(afterFirstUndo.name).toBe(originalName)
      expect(afterFirstUndo[`cf_${textKey}`], 'undo of the first update restores the original value').toBe('winter')
      expect(asStringArray(afterFirstUndo[`cf_${multiKey}`])).toEqual(['web'])
    } finally {
      await deleteCatalogCategoryIfExists(request, token, categoryId)
      await deleteCategoryDefinition(request, token, textKey)
      await deleteCategoryDefinition(request, token, multiKey)
    }
  })
})
