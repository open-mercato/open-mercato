import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { deleteCatalogCategoryIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  expectOperation,
  skipIfUndoTestsDisabled,
  undoByToken,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'

const CATEGORIES_PATH = '/api/catalog/categories'
const PARENT_CYCLE_CODE = 'catalog.categories.errors.parentCycle'
const PARENT_CYCLE_MESSAGE = "A category can't be moved under itself or one of its subcategories."
const REPLAY_CYCLE_CODE = 'catalog.categories.errors.replayCycle'
const REPLAY_CYCLE_MESSAGE =
  "The category hierarchy changed since this action, so it can't be reverted without making a category its own ancestor."

/**
 * TC-CAT-UNDO-006
 *
 * A category's parent must never become one of its own descendants. Covers
 * moving a category under its child or grandchild (400, tree untouched),
 * undoing an update whose old parent was later moved under the category
 * (409, tree untouched, the same undo succeeds once the obstruction is
 * cleared), a cycle already stored in the database being repaired by the
 * next hierarchy rebuild, and the edit form showing the translated error.
 *
 * Self-contained: creates its own categories and removes them in finally.
 */

type StoredCategory = {
  id: string
  parent_id: string | null
  ancestor_ids: string[]
  descendant_ids: string[]
}

function stampName(label: string, stamp: string): string {
  return `QA TC-CAT-UNDO-006 ${label} ${stamp}`
}

async function createCategory(
  request: APIRequestContext,
  token: string,
  name: string,
  parentId: string | null = null,
): Promise<string> {
  const response = await apiRequest(request, 'POST', CATEGORIES_PATH, {
    token,
    data: parentId ? { name, parentId } : { name },
  })
  expect(response.status(), `POST ${CATEGORIES_PATH} should create ${name}`).toBe(201)
  return expectId((await readJsonSafe<Record<string, unknown>>(response))?.id, 'category id')
}

async function readStored(ids: string[]): Promise<Map<string, StoredCategory>> {
  const rows = await withClient((client) =>
    client.query<StoredCategory>(
      'select id, parent_id, ancestor_ids, descendant_ids from catalog_product_categories where id = any($1::uuid[])',
      [ids],
    ),
  )
  return new Map(rows.rows.map((row) => [row.id, row]))
}

async function expectTree(expected: Record<string, string | null>): Promise<void> {
  const ids = Object.keys(expected)
  const stored = await readStored(ids)
  for (const id of ids) {
    const row = stored.get(id)
    expect(row, `category ${id} should exist`).toBeTruthy()
    expect(row!.parent_id, `parent of ${id}`).toBe(expected[id])
    expect(row!.descendant_ids, `${id} must not be its own descendant`).not.toContain(id)
    expect(row!.ancestor_ids, `${id} must not be its own ancestor`).not.toContain(id)
  }
}

async function updateParent(
  request: APIRequestContext,
  token: string,
  id: string,
  parentId: string | null,
) {
  return apiRequest(request, 'PUT', CATEGORIES_PATH, { token, data: { id, parentId } })
}

async function cleanup(request: APIRequestContext, token: string | null, ids: string[]): Promise<void> {
  if (!token) return
  for (const id of [...ids].reverse()) {
    await deleteCatalogCategoryIfExists(request, token, id)
  }
}

test.describe('TC-CAT-UNDO-006: category parent cycles are refused', () => {
  test('moving a category under its child or grandchild is refused', async ({ request }) => {
    const stamp = randomUUID().slice(0, 8)
    const created: string[] = []
    let token: string | null = null
    try {
      token = await getAuthToken(request)
      const top = await createCategory(request, token, stampName('Top', stamp))
      created.push(top)
      const child = await createCategory(request, token, stampName('Child', stamp), top)
      created.push(child)
      const grandchild = await createCategory(request, token, stampName('Grandchild', stamp), child)
      created.push(grandchild)

      for (const target of [child, grandchild]) {
        const response = await updateParent(request, token, top, target)
        expect(response.status(), 'PUT with a descendant parent should be refused').toBe(400)
        const body = await readJsonSafe<{ error?: string; code?: string }>(response)
        expect(body?.code).toBe(PARENT_CYCLE_CODE)
        expect(body?.error).toBe(PARENT_CYCLE_MESSAGE)
      }

      await expectTree({ [top]: null, [child]: top, [grandchild]: child })

      const allowed = await updateParent(request, token, grandchild, top)
      expect(allowed.status(), 'moving a category under an ancestor stays allowed').toBe(200)
      await expectTree({ [top]: null, [child]: top, [grandchild]: top })
    } finally {
      await cleanup(request, token, created)
    }
  })

  test('undoing an update whose old parent now sits below the category is refused', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const stamp = randomUUID().slice(0, 8)
    const created: string[] = []
    let token: string | null = null
    try {
      token = await getAuthToken(request)
      const formerParent = await createCategory(request, token, stampName('Former parent', stamp))
      created.push(formerParent)
      const moved = await createCategory(request, token, stampName('Moved', stamp), formerParent)
      created.push(moved)

      const detach = await updateParent(request, token, moved, null)
      expect(detach.status(), 'detaching the category').toBe(200)
      const detachOp = expectOperation(detach, 'catalog.categories.update')

      const reparent = await updateParent(request, token, formerParent, moved)
      expect(reparent.status(), 'moving the former parent under the category').toBe(200)
      await expectTree({ [moved]: null, [formerParent]: moved })

      const refused = await undoByToken(request, token, detachOp.undoToken)
      expect(refused.status(), 'undo that would close a cycle should be refused').toBe(409)
      const refusedBody = await readJsonSafe<{ error?: string; code?: string }>(refused)
      expect(refusedBody?.code).toBe(REPLAY_CYCLE_CODE)
      expect(refusedBody?.error).toBe(REPLAY_CYCLE_MESSAGE)
      await expectTree({ [moved]: null, [formerParent]: moved })

      const clear = await updateParent(request, token, formerParent, null)
      expect(clear.status(), 'clearing the obstruction').toBe(200)

      await undoOk(request, token, detachOp.undoToken, 'category detach undo after the obstruction is cleared')
      await expectTree({ [moved]: formerParent, [formerParent]: null })
    } finally {
      await cleanup(request, token, created)
    }
  })

  test('a cycle already stored in the database is repaired by the next hierarchy rebuild', async ({ request }) => {
    const stamp = randomUUID().slice(0, 8)
    const created: string[] = []
    let token: string | null = null
    try {
      token = await getAuthToken(request)
      const first = await createCategory(request, token, stampName('Cycle one', stamp))
      created.push(first)
      const second = await createCategory(request, token, stampName('Cycle two', stamp))
      created.push(second)
      const bystander = await createCategory(request, token, stampName('Bystander', stamp))
      created.push(bystander)

      await withClient((client) =>
        client.query(
          'update catalog_product_categories set parent_id = case when id = $1::uuid then $2::uuid else $1::uuid end where id = any($3::uuid[])',
          [first, second, [first, second]],
        ),
      )

      const rename = await apiRequest(request, 'PUT', CATEGORIES_PATH, {
        token,
        data: { id: bystander, name: stampName('Bystander renamed', stamp) },
      })
      expect(rename.status(), 'an unrelated update rebuilds the hierarchy').toBe(200)

      const [smaller, larger] = [first, second].sort()
      await expectTree({ [smaller]: null, [larger]: smaller, [bystander]: null })
      const stored = await readStored([smaller])
      expect(stored.get(smaller)!.descendant_ids).toEqual([larger])
    } finally {
      await cleanup(request, token, created)
    }
  })

  test('the edit form shows the translated error when a subcategory is chosen as parent', async ({ page, request }) => {
    const stamp = randomUUID().slice(0, 8)
    const created: string[] = []
    let token: string | null = null
    try {
      token = await getAuthToken(request)
      const top = await createCategory(request, token, stampName('Form top', stamp))
      created.push(top)
      const child = await createCategory(request, token, stampName('Form child', stamp), top)
      created.push(child)

      await login(page, 'admin')
      await page.goto(`/backend/catalog/categories/${top}/edit`)
      const select = page.locator('select#parentId')
      await expect(select).toBeVisible({ timeout: 15_000 })
      await expect(select.locator(`option[value="${child}"]`)).toBeAttached({ timeout: 15_000 })
      await select.selectOption(child)

      const saveResponse = page.waitForResponse(
        (response) => response.url().includes(CATEGORIES_PATH) && response.request().method() === 'PUT',
      )
      await page.getByRole('button', { name: /Save/i }).first().click()
      expect((await saveResponse).status()).toBe(400)

      await expect(page.getByText(PARENT_CYCLE_MESSAGE).first()).toBeVisible({ timeout: 10_000 })
      await expect(page).toHaveURL(new RegExp(`/backend/catalog/categories/${top}/edit$`))
      await expectTree({ [top]: null, [child]: top })
    } finally {
      await cleanup(request, token, created)
    }
  })
})
