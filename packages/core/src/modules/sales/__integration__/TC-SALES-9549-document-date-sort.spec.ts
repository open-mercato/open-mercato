import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

const earlierDate = '2000-02-10'
const laterDate = '2099-09-12'

for (const resource of ['orders', 'quotes'] as const) {
  test(`sorts sales ${resource} by their displayed dates across pages`, async ({ request, page }, testInfo) => {
    const token = await getAuthToken(request)
    const path = `/api/sales/${resource}`
    const search = `date-sort-${randomUUID().slice(0, 8)}`
    const numbers = new Map<string, string>()
    const isOrder = resource === 'orders'

    async function createDocument(suffix: string, dates: { placedAt?: string; validUntil?: string }) {
      const number = `${search}-${suffix}`
      const response = await apiRequest(request, 'POST', path, {
        token,
        retryTransport: false,
        data: isOrder
          ? {
              orderNumber: number,
              currencyCode: 'USD',
              placedAt: dates.placedAt,
              lines: [{ name: number, currencyCode: 'USD', quantity: 1, unitPriceNet: 0, unitPriceGross: 0 }],
            }
          : { quoteNumber: number, currencyCode: 'USD', validUntil: dates.validUntil },
      })
      expect(response.status()).toBe(201)
      const body = await readJsonSafe<{ id: string }>(response)
      if (!body?.id) throw new Error('[internal] Sales fixture response is missing its id')
      numbers.set(body.id, number)
      if (!isOrder && dates.placedAt) {
        const update = await apiRequest(request, 'PUT', path, { token, data: { id: body.id, placedAt: dates.placedAt } })
        expect(update.ok()).toBe(true)
      }
      return body.id
    }

    try {
      const placed = await createDocument('placed', { placedAt: laterDate, validUntil: earlierDate })
      const created = await createDocument('created', {})
      const earlier = isOrder ? { placedAt: earlierDate } : { validUntil: earlierDate }
      const tieA = await createDocument('tie-a', earlier)
      const tieB = await createDocument('tie-b', earlier)
      const tied = [tieA, tieB].sort()
      const ids = [...numbers.keys()].join(',')

      for (const sortDir of ['asc', 'desc']) {
        const expected = sortDir === 'asc' ? [...tied, created, placed] : [placed, created, ...tied]
        for (const pageNumber of [1, 2]) {
          const query = new URLSearchParams({
            ids, sortField: 'documentDate', sortDir, page: String(pageNumber), pageSize: '2',
          })
          const response = await apiRequest(request, 'GET', `${path}?${query}`, { token })
          expect(response.status()).toBe(200)
          const body = await readJsonSafe<{ items: { id: string }[]; total: number }>(response)
          expect(body?.total, `${sortDir} page ${pageNumber} total`).toBe(4)
          expect(body?.items.map(({ id }) => id), `${sortDir} page ${pageNumber} order`).toEqual(
            expected.slice((pageNumber - 1) * 2, pageNumber * 2),
          )
        }
      }

      await page.setViewportSize({ width: 1680, height: 900 })
      await login(page, 'admin')
      const listPath = `/backend/sales/${resource}`
      await page.request.get(`/api/auth/locale?locale=en&redirect=${listPath}`, { maxRedirects: 0 })
      await page.goto(listPath)
      const filtered = page.waitForResponse((response) => {
        const url = new URL(response.url())
        return url.pathname === path && url.searchParams.get('search') === search
      })
      await page.getByPlaceholder(`Search ${resource}…`).fill(search)
      expect((await filtered).ok()).toBe(true)
      const documents = page.getByRole('table').getByText(search)
      const documentNumbers = (order: string[]) => order.map((id) => numbers.get(id)!)
      await expect(documents).toHaveText(documentNumbers([placed, created, ...tied]))
      await page.getByRole('columnheader').getByRole('button', { name: 'Date', exact: true }).click()
      await expect(documents).toHaveText(documentNumbers([...tied, created, placed]))
      await testInfo.attach(`${resource}-date-ascending`, {
        body: await page.screenshot(), contentType: 'image/png',
      })
    } finally {
      for (const id of numbers.keys()) await deleteSalesEntityIfExists(request, token, path, id)
    }
  })
}
