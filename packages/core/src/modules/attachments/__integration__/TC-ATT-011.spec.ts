import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  deleteAttachmentIfExists,
  uploadAttachmentFixture,
} from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'

/**
 * TC-ATT-011: Library search, tag filter, sorting and pagination
 * Source: GitHub issue #2488 (attachments integration coverage)
 * Surface: /api/attachments/library (GET)
 *
 * The library lists every attachment in the caller's tenant/org, so this test
 * isolates its fixtures with a unique fileName prefix and unique tags. Within that
 * isolated set it asserts fileName ILIKE search, tag containment filtering,
 * fileName/createdAt sorting, and page/pageSize pagination.
 */

type LibraryItem = { id: string; fileName: string }
type LibraryResponse = {
  items?: LibraryItem[]
  total?: number
  page?: number
  pageSize?: number
  totalPages?: number
}

async function libraryQuery(
  request: APIRequestContext,
  token: string,
  query: string,
): Promise<LibraryResponse> {
  const response = await apiRequest(request, 'GET', `/api/attachments/library?${query}`, { token })
  expect(response.status(), `GET /api/attachments/library?${query} should be 200`).toBe(200)
  return (await readJsonSafe<LibraryResponse>(response)) ?? {}
}

test.describe('TC-ATT-011: Attachment library search, filter, sort, pagination', () => {
  test('should search by name, filter by tag, sort, and paginate within an isolated set', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const prefix = `att011-${stamp}-`
    const tagMonthly = `att011-monthly-${stamp}`
    const tagFinancial = `att011-financial-${stamp}`
    const recordId = `qa-library-011-${stamp}`

    let janId: string | null = null
    let febId: string | null = null
    let marchId: string | null = null

    // Restrict response items to this test's own fixtures, preserving server order.
    const ownOrder = (items: LibraryItem[] | undefined, own: Set<string>): string[] =>
      (items ?? []).map((item) => item.id).filter((id) => own.has(id))

    try {
      // Uploaded sequentially so createdAt is strictly increasing: jan < feb < march.
      const jan = await uploadAttachmentFixture(request, token, {
        entityId: 'attachments:library',
        recordId,
        fileName: `${prefix}report-jan.txt`,
        mimeType: 'text/plain',
        buffer: Buffer.from('january report', 'utf8'),
        tags: [tagMonthly],
      })
      janId = jan.id
      const feb = await uploadAttachmentFixture(request, token, {
        entityId: 'attachments:library',
        recordId,
        fileName: `${prefix}report-feb.txt`,
        mimeType: 'text/plain',
        buffer: Buffer.from('february report', 'utf8'),
        tags: [tagMonthly],
      })
      febId = feb.id
      const march = await uploadAttachmentFixture(request, token, {
        entityId: 'attachments:library',
        recordId,
        fileName: `${prefix}invoice-march.txt`,
        mimeType: 'text/plain',
        buffer: Buffer.from('march invoice', 'utf8'),
        tags: [tagFinancial],
      })
      marchId = march.id

      const ownIds = new Set<string>([janId, febId, marchId])

      // 1) Search by fileName (ILIKE) — "report" prefix matches the two reports only.
      const reportSearch = await libraryQuery(request, token, `search=${encodeURIComponent(`${prefix}report`)}`)
      const reportIds = new Set(ownOrder(reportSearch.items, ownIds))
      expect(reportIds.has(janId)).toBe(true)
      expect(reportIds.has(febId)).toBe(true)
      expect(reportIds.has(marchId)).toBe(false)

      // 2) Search isolates the invoice file only.
      const invoiceSearch = await libraryQuery(request, token, `search=${encodeURIComponent(`${prefix}invoice`)}`)
      const invoiceIds = new Set(ownOrder(invoiceSearch.items, ownIds))
      expect(invoiceIds.has(marchId)).toBe(true)
      expect(invoiceIds.has(janId)).toBe(false)
      expect(invoiceIds.has(febId)).toBe(false)

      // 3) Tag filter — monthly tag returns the two reports.
      const monthly = await libraryQuery(request, token, `tags=${encodeURIComponent(tagMonthly)}`)
      const monthlyIds = new Set(ownOrder(monthly.items, ownIds))
      expect(monthlyIds.has(janId)).toBe(true)
      expect(monthlyIds.has(febId)).toBe(true)
      expect(monthlyIds.has(marchId)).toBe(false)

      // 4) Tag filter — financial tag returns the invoice only.
      const financial = await libraryQuery(request, token, `tags=${encodeURIComponent(tagFinancial)}`)
      const financialIds = new Set(ownOrder(financial.items, ownIds))
      expect(financialIds.has(marchId)).toBe(true)
      expect(financialIds.has(janId)).toBe(false)
      expect(financialIds.has(febId)).toBe(false)

      // 5) Sort by fileName ascending → invoice-march, report-feb, report-jan.
      const byNameAsc = await libraryQuery(
        request,
        token,
        `search=${encodeURIComponent(prefix)}&sortField=fileName&sortDir=asc`,
      )
      expect(ownOrder(byNameAsc.items, ownIds)).toEqual([marchId, febId, janId])

      // 6) Sort by createdAt descending → newest first (march, feb, jan).
      const byCreatedDesc = await libraryQuery(
        request,
        token,
        `search=${encodeURIComponent(prefix)}&sortField=createdAt&sortDir=desc`,
      )
      expect(ownOrder(byCreatedDesc.items, ownIds)).toEqual([marchId, febId, janId])

      // 7) Pagination over the isolated set (alphabetical), pageSize 2.
      const page1 = await libraryQuery(
        request,
        token,
        `search=${encodeURIComponent(prefix)}&sortField=fileName&sortDir=asc&page=1&pageSize=2`,
      )
      expect(page1.total).toBe(3)
      expect(page1.totalPages).toBe(2)
      expect(ownOrder(page1.items, ownIds)).toEqual([marchId, febId])

      const page2 = await libraryQuery(
        request,
        token,
        `search=${encodeURIComponent(prefix)}&sortField=fileName&sortDir=asc&page=2&pageSize=2`,
      )
      expect(ownOrder(page2.items, ownIds)).toEqual([janId])
    } finally {
      await deleteAttachmentIfExists(request, token, janId)
      await deleteAttachmentIfExists(request, token, febId)
      await deleteAttachmentIfExists(request, token, marchId)
    }
  })
})
