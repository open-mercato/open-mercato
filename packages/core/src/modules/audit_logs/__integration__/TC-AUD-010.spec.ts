import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createCategoryFixture,
  deleteCatalogCategoryIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { ACTIONS_PATH, listActionLogs, type ActionLogQuery } from './helpers/auditLogsApi'

const CATEGORY_RESOURCE_KIND = 'catalog.category'
const RENAME_COUNT = 21
const EXPECTED_TOTAL = RENAME_COUNT + 1
const VERSION_HISTORY_PAGE_SIZE = 20
const TIED_GROUPS = [
  [5, 6, 7, 8],
  [19, 20, 21],
]

async function renameCategory(request: APIRequestContext, token: string, categoryId: string, name: string) {
  const response = await apiRequest(request, 'PUT', '/api/catalog/categories', {
    token,
    data: { id: categoryId, name },
  })
  expect(response.status(), `renaming the category to ${name} succeeds`).toBe(200)
}

async function listIds(request: APIRequestContext, token: string, query: ActionLogQuery): Promise<string[]> {
  const result = await listActionLogs(request, token, query)
  expect(result.status, `listing ${JSON.stringify(query)} returns 200`).toBe(200)
  return result.body!.items.map((item) => item.id)
}

async function tieTimestamps(ids: string[]) {
  await withClient(async (client) => {
    await client.query(
      'update action_logs set created_at = (select created_at from action_logs where id = $1) where id = any($2::uuid[])',
      [ids[0], ids],
    )
  })
}

async function readTiedCounts(ids: string[]): Promise<number[]> {
  return withClient(async (client) => {
    const { rows } = await client.query<{ tied: string }>(
      'select count(*)::text as tied from action_logs where id = any($1::uuid[]) group by created_at order by count(*) desc',
      [ids],
    )
    return rows.map((row) => Number(row.tied))
  })
}

async function traverse(
  request: APIRequestContext,
  token: string,
  scope: ActionLogQuery,
  pageSize: number,
): Promise<string[][]> {
  const pages: string[][] = []
  for (let page = 1; page <= Math.ceil(EXPECTED_TOTAL / pageSize) + 1; page += 1) {
    pages.push(await listIds(request, token, { ...scope, page, pageSize }))
  }
  return pages
}

async function collectVersionHistoryIds(page: Page, categoryId: string): Promise<{ ids: string[]; requests: number }> {
  const ids: string[] = []
  let requests = 0
  page.on('response', async (response) => {
    const url = new URL(response.url())
    if (url.pathname !== ACTIONS_PATH || url.searchParams.get('resourceId') !== categoryId) return
    const body = (await response.json()) as { items?: Array<{ id: string }> }
    for (const item of body.items ?? []) ids.push(item.id)
    requests += 1
  })

  await page.goto(`/backend/catalog/categories/${encodeURIComponent(categoryId)}/edit`)
  await page.getByRole('button', { name: 'Version History' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Version History' })
  const loadMore = dialog.getByRole('button', { name: 'Load more' })
  await expect(loadMore, 'the first page offers more history').toBeVisible()
  await expect.poll(() => ids.length, { message: 'the first page arrives' }).toBe(VERSION_HISTORY_PAGE_SIZE)
  await loadMore.click()
  await expect(loadMore, 'the second page is the last one').toBeHidden()
  await expect.poll(() => requests, { message: 'load more issues one request' }).toBe(2)
  await expect.poll(() => ids.length, { message: 'both pages arrive' }).toBe(EXPECTED_TOTAL)
  return { ids, requests }
}

/**
 * TC-AUD-010: Action log pages keep rows that share a timestamp
 * Covers:
 *   - GET  /api/audit_logs/audit-logs/actions
 *   - POST /api/catalog/categories
 *   - PUT  /api/catalog/categories
 *   - Version History panel on /backend/catalog/categories/{id}/edit
 *
 * One category is created and renamed 21 times, leaving 22 action logs for it.
 * Two groups of neighbouring rows are then given identical created_at values in
 * Postgres: positions 6-9 straddle the 7-row page boundary and positions 20-22
 * straddle Version History's 20-row page boundary. Every traversal must return
 * each row exactly once, in the stable (created_at, id) order of the baseline.
 * A second category is renamed 25 more times after its Version History panel
 * opens; every Load more must advance the offset by a full page and still reach
 * every original row.
 */
test.describe('TC-AUD-010: action log pages keep rows that share a timestamp', () => {
  test('page traversal and Version History load more reach every tied row once', async ({ page, request }) => {
    let token: string | null = null
    let categoryId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const uniqueSuffix = `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`
      categoryId = await createCategoryFixture(request, token, { name: `aud010 original ${uniqueSuffix}` })
      for (let index = 1; index <= RENAME_COUNT; index += 1) {
        await renameCategory(request, token, categoryId, `aud010 rename ${index} ${uniqueSuffix}`)
      }

      const scope = { resourceKind: CATEGORY_RESOURCE_KIND, resourceId: categoryId }
      const historyScope = { ...scope, includeRelated: 'true' }
      const initialIds = await listIds(request, token, { ...scope, pageSize: 200 })
      expect(initialIds.length, 'the category has one create log and one log per rename').toBe(EXPECTED_TOTAL)

      const tiedIds = TIED_GROUPS.map((group) => group.map((position) => initialIds[position]))
      for (const ids of tiedIds) await tieTimestamps(ids)
      expect(await readTiedCounts(tiedIds.flat()), 'Postgres holds the two tied groups').toEqual([4, 3])

      const baseline = await listIds(request, token, { ...scope, pageSize: 200 })
      expect(new Set(baseline).size, 'baseline ids are unique').toBe(EXPECTED_TOTAL)
      expect(await listIds(request, token, { ...historyScope, pageSize: 200 }), 'related scope adds no rows').toEqual(baseline)
      for (const ids of tiedIds) {
        const positions = ids.map((id) => baseline.indexOf(id)).sort((left, right) => left - right)
        expect(positions[positions.length - 1] - positions[0], 'tied rows stay neighbours').toBe(ids.length - 1)
      }

      for (const pageSize of [7, VERSION_HISTORY_PAGE_SIZE]) {
        const pages = await traverse(request, token, scope, pageSize)
        expect(pages.flat(), `pages of ${pageSize} return every row once, in baseline order`).toEqual(baseline)
        expect(pages[pages.length - 1], `the page after the last page of ${pageSize} is empty`).toEqual([])
      }

      const ascending = await listIds(request, token, { ...scope, sortDir: 'asc', pageSize: 200 })
      expect(ascending, 'ascending order is the exact reverse of the baseline').toEqual([...baseline].reverse())
      const ascendingPages = await traverse(request, token, { ...scope, sortDir: 'asc' }, 7)
      expect(ascendingPages.flat(), 'ascending pages of 7 return every row once').toEqual(ascending)

      const offsetPages = [
        await listIds(request, token, { ...historyScope, limit: VERSION_HISTORY_PAGE_SIZE }),
        await listIds(request, token, { ...historyScope, limit: VERSION_HISTORY_PAGE_SIZE, offset: VERSION_HISTORY_PAGE_SIZE }),
      ]
      expect(offsetPages.flat(), 'limit and offset windows return every row once').toEqual(baseline)

      await login(page, 'admin')
      const history = await collectVersionHistoryIds(page, categoryId)
      expect(history.ids, 'Version History receives every row exactly once, in baseline order').toEqual(baseline)
      await expect(
        page.getByRole('dialog', { name: 'Version History' }).locator('.divide-y > div'),
        'the panel renders one row per action log',
      ).toHaveCount(EXPECTED_TOTAL)
      await page.screenshot({ path: test.info().outputPath('version-history-tied-rows.png'), fullPage: true })
    } finally {
      await deleteCatalogCategoryIfExists(request, token, categoryId)
    }
  })

  test('Version History load more keeps progressing when rows are written while the panel is open', async ({ page, request }) => {
    let token: string | null = null
    let categoryId: string | null = null
    const liveRenameCount = VERSION_HISTORY_PAGE_SIZE + 5

    try {
      token = await getAuthToken(request, 'admin')
      const uniqueSuffix = `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`
      categoryId = await createCategoryFixture(request, token, { name: `aud010 live original ${uniqueSuffix}` })
      for (let index = 1; index <= RENAME_COUNT; index += 1) {
        await renameCategory(request, token, categoryId, `aud010 live rename ${index} ${uniqueSuffix}`)
      }
      const scope = { resourceKind: CATEGORY_RESOURCE_KIND, resourceId: categoryId }
      const baseline = await listIds(request, token, { ...scope, pageSize: 200 })
      expect(baseline.length, 'the category starts with one create log and one log per rename').toBe(EXPECTED_TOTAL)

      const offsets: number[] = []
      const receivedIds: string[] = []
      page.on('response', async (response) => {
        const url = new URL(response.url())
        if (url.pathname !== ACTIONS_PATH || url.searchParams.get('resourceId') !== categoryId) return
        offsets.push(Number(url.searchParams.get('offset') ?? 0))
        const body = (await response.json()) as { items?: Array<{ id: string }> }
        for (const item of body.items ?? []) receivedIds.push(item.id)
      })

      await login(page, 'admin')
      await page.goto(`/backend/catalog/categories/${encodeURIComponent(categoryId)}/edit`)
      await page.getByRole('button', { name: 'Version History' }).first().click()
      const dialog = page.getByRole('dialog', { name: 'Version History' })
      const rows = dialog.locator('.divide-y > div')
      const loadMore = dialog.getByRole('button', { name: 'Load more' })
      await expect(rows, 'the first page renders').toHaveCount(VERSION_HISTORY_PAGE_SIZE)

      for (let index = 1; index <= liveRenameCount; index += 1) {
        await renameCategory(request, token, categoryId, `aud010 live write ${index} ${uniqueSuffix}`)
      }

      for (let click = 1; click <= 5 && (await loadMore.isVisible()); click += 1) {
        await loadMore.click()
        await expect.poll(() => offsets.length, { message: `load more click ${click} issues one request` }).toBe(click + 1)
        await expect
          .poll(async () => !(await loadMore.isVisible()) || (await loadMore.isEnabled()), {
            message: `load more click ${click} settles`,
          })
          .toBe(true)
      }

      await expect(loadMore, 'load more disappears once the oldest row arrives').toBeHidden()
      expect(offsets, 'every click advances the offset by one full page').toEqual([0, 20, 40])
      expect(baseline.every((id) => receivedIds.includes(id)), 'no original row is skipped').toBe(true)
      await expect(rows, 'the panel renders each received row once').toHaveCount(new Set(receivedIds).size)
      await page.screenshot({ path: test.info().outputPath('version-history-live-inserts.png'), fullPage: true })
    } finally {
      await deleteCatalogCategoryIfExists(request, token, categoryId)
    }
  })
})
