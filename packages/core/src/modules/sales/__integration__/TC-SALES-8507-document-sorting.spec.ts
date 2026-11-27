import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

async function sortDocuments(page: Page, resource: string, prefix: string, label: string, field: string, direction: string) {
  const pending = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'GET'
      && url.pathname === `/api/sales/${resource}`
      && url.searchParams.get('search') === prefix
      && url.searchParams.get('sortField') === field
      && url.searchParams.get('sortDir') === direction
      && url.searchParams.get('page') === '1'
  })
  await page.getByRole('columnheader').getByRole('button', { name: label, exact: true }).click()
  const response = await pending
  expect(response.status()).toBe(200)
  return response
}

for (const { resource, numberField, label } of [
  { resource: 'orders', numberField: 'orderNumber', label: 'Order' },
  { resource: 'quotes', numberField: 'quoteNumber', label: 'Quote' },
]) {
  test.describe(`TC-SALES-8507: ${resource} server sorting`, () => {
    const prefix = `QA8507-${randomUUID().slice(0, 8)}`
    const numbers = Array.from({ length: 21 }, (_, index) => `${prefix}-${String(index).padStart(2, '0')}`)
    const fixtureIds: string[] = []
    let token: string

    test.beforeAll(async ({ request }) => {
      token = await getAuthToken(request, 'admin')
      for (let offset = 0; offset < numbers.length; offset += 7) {
        await Promise.all(numbers.slice(offset, offset + 7).reverse().map(async (number) => {
          const response = await apiRequest(request, 'POST', `/api/sales/${resource}`, {
            token,
            retryTransport: false,
            data: {
              [numberField]: number,
              currencyCode: 'USD',
              lines: [{ name: number, currencyCode: 'USD', quantity: 1, unitPriceNet: 1, unitPriceGross: 1 }],
            },
          })
          expect(response.status()).toBe(201)
          fixtureIds.push(expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'Owned sales document id'))
        }))
      }
    })

    test.afterAll(async ({ request }) => {
      for (const id of fixtureIds) {
        const response = await apiRequest(request, 'DELETE', `/api/sales/${resource}?id=${id}`, { token })
        expect(response.status()).toBe(200)
      }
    })

    test('sorts persisted numbers both ways and resets pagination for each sortable field', async ({ page }) => {
      await login(page, 'admin')
      await page.goto(`/backend/sales/${resource}`)
      const search = page.getByPlaceholder(`Search ${resource}…`, { exact: true })
      const filtered = page.waitForResponse((response) => {
        const url = new URL(response.url())
        return url.pathname === `/api/sales/${resource}` && url.searchParams.get('search') === prefix
      })
      await search.fill(prefix)
      expect(((await (await filtered).json()) as { total: number }).total).toBe(21)
      await expect(page.getByRole('table').getByRole('row').filter({ hasText: prefix })).toHaveCount(20)
      await expect(page.getByRole('columnheader').getByRole('button')).toHaveCount(5)

      for (const direction of ['asc', 'desc']) {
        const response = await sortDocuments(page, resource, prefix, label, 'number', direction)
        const payload = await response.json() as { items: Array<Record<string, unknown>>; total: number }
        const expected = direction === 'asc' ? numbers.slice(0, 20) : [...numbers].reverse().slice(0, 20)
        expect(payload?.total).toBe(21)
        expect(payload?.items.map((item) => item[numberField])).toEqual(expected)
        const rows = page.getByRole('table').getByRole('row').filter({ hasText: prefix })
        await expect(rows).toHaveCount(20)
        for (let index = 0; index < expected.length; index += 1) {
          await expect(rows.nth(index)).toContainText(expected[index])
        }
      }

      for (const [header, field] of [
        ['Items', 'lineItemCount'],
        ['Total (net)', 'grandTotalNetAmount'],
        ['Total (gross)', 'grandTotalGrossAmount'],
        ['Date', 'createdAt'],
      ]) {
        const pageTwo = page.waitForResponse((response) => {
          const url = new URL(response.url())
          return url.pathname === `/api/sales/${resource}` && url.searchParams.get('page') === '2'
        })
        await page.getByRole('button', { name: 'Next page', exact: true }).click()
        expect((await pageTwo).status()).toBe(200)
        await sortDocuments(page, resource, prefix, header, field, 'asc')
      }
    })
  })
}
