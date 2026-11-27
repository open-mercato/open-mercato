import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const PEOPLE = '/api/customers/people'
const PAGE_SIZE = 50
const FIXTURE_BATCH_SIZE = 10

const cases = [
  { category: 'Tags', source: 'tags', total: 51, servedPageNumber: 2, nextItemCount: 1, termination: 'a short page' },
  { category: 'Labels', source: 'labels', total: 50, servedPageNumber: 1, nextItemCount: 50, termination: 'a clamped full page' },
] as const

type CategoryPage = { page: number; total: number; items: Array<{ id: string; label: string }> }

async function runFixtureBatches(values: string[], run: (value: string) => Promise<void>): Promise<void> {
  const failures: unknown[] = []
  for (let start = 0; start < values.length; start += FIXTURE_BATCH_SIZE) {
    const results = await Promise.allSettled(values.slice(start, start + FIXTURE_BATCH_SIZE).map(run))
    for (const result of results) {
      if (result.status === 'rejected') failures.push(result.reason)
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, '[internal] Customer fixture requests failed')
}

for (const { category, source, total, servedPageNumber, nextItemCount, termination } of cases) {
  test(`TC-CRM-5404: Edit tags stops loading ${source} after ${termination}`, async ({ page, request }) => {
    const token = await getAuthToken(request)
    const prefix = `qa-${source}-${randomUUID()}`
    const personId = await createPersonFixture(request, token, {
      firstName: 'QA',
      lastName: category,
      displayName: prefix,
    })
    const endpoint = `/api/customers/${source}`
    const createdIds: string[] = []

    try {
      const labels = Array.from({ length: total }, (_, index) => `${prefix}-${index + 1}`)
      await runFixtureBatches(labels, async (label) => {
        const response = await apiRequest(request, 'POST', endpoint, {
          token,
          data: source === 'tags' ? { label, slug: label } : { label },
        })
        expect(response.status(), `Create ${label}`).toBe(201)
        const created = await readJsonSafe<{ id: string }>(response)
        createdIds.push(expectId(created?.id, `Created ${label} id`))
      })

      await login(page, 'admin')
      await page.goto(`/backend/customers/people-v2/${personId}`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: 'Edit tags', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Edit tags' })
      await dialog.getByRole('button', { name: `${category} 0`, exact: true }).click()

      const waitForCategoryPage = (pageNumber: number) => page.waitForResponse((response) => {
        const url = new URL(response.url())
        return response.request().method() === 'GET'
          && url.pathname === endpoint
          && url.searchParams.get('search') === prefix
          && url.searchParams.get('page') === String(pageNumber)
          && url.searchParams.get('pageSize') === String(PAGE_SIZE)
      })
      const [firstResponse] = await Promise.all([
        waitForCategoryPage(1),
        dialog.getByPlaceholder(`Search ${source}...`).fill(prefix),
      ])
      expect(firstResponse.ok(), `${category} page 1`).toBe(true)
      const firstPage = await firstResponse.json() as CategoryPage
      expect(firstPage).toMatchObject({ page: 1, total })
      expect(firstPage.items).toHaveLength(PAGE_SIZE)

      const chips = dialog.getByRole('button', { name: new RegExp(`^${prefix}-[0-9]+$`) })
      const loadMore = dialog.getByRole('button', { name: 'Load more', exact: true })
      await expect(chips).toHaveCount(PAGE_SIZE)
      await expect(loadMore).toBeVisible()

      const [nextResponse] = await Promise.all([waitForCategoryPage(2), loadMore.click()])
      expect(nextResponse.ok(), `${category} request for page 2`).toBe(true)
      const servedPage = await nextResponse.json() as CategoryPage
      expect(servedPage.page).toBe(servedPageNumber)
      expect(servedPage.items).toHaveLength(nextItemCount)
      if (source === 'labels') expect(servedPage.items).toEqual(firstPage.items)
      await expect(dialog.getByRole('button', { name: /^(Load more|Retry)$/ })).toHaveCount(0)
      await expect(chips).toHaveCount(total)
    } finally {
      try {
        if (source === 'tags') {
          await runFixtureBatches(createdIds, async (id) => {
            const response = await apiRequest(request, 'DELETE', `${endpoint}?id=${encodeURIComponent(id)}`, { token })
            expect(response.ok(), `Delete tag fixture returned ${response.status()}`).toBe(true)
          })
        } else if (createdIds.length > 0) {
          await withClient(async (client) => {
            await client.query('delete from customer_labels where id = any($1::uuid[])', [createdIds])
          })
        }
      } finally {
        await deleteEntityIfExists(request, token, PEOPLE, personId)
      }
    }
  })
}
