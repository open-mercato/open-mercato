import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { canManageSalesOrders } from '@open-mercato/core/helpers/integration/salesFixtures'

/**
 * TC-SALES-8232: a gross-only discounted line keeps its totals when another
 * line is added.
 *
 * Issue: #8232
 *
 * A document created with a line that sends `unitPriceGross`, a line discount
 * and no `unitPriceNet` used to store the unit net after the discount in
 * `unit_price_net`. The next recalculating write read it back as the price
 * before the discount and applied the discount again, so the line net and the
 * document net went down while the line tax and gross stayed. These cases
 * drive the real create route, the `numeric(18,4)` round trip, and a line
 * upsert that recalculates the document from the stored rows.
 *
 * Self-contained: every fixture is created through the API and deleted in
 * `finally`; nothing here depends on seeded or demo data.
 */

type DocumentKind = 'order' | 'quote'
type LineRecord = Record<string, unknown>
type DocumentRecord = Record<string, unknown>

const GROSS_ONLY_LINE = { quantity: 1, unitPriceGross: 123, taxRate: 23, discountPercent: 10 }

function amount(record: Record<string, unknown>, snakeKey: string, camelKey: string): number {
  return Number(record[snakeKey] ?? record[camelKey] ?? Number.NaN)
}

async function readLines(
  request: APIRequestContext,
  token: string,
  documentKind: DocumentKind,
  documentId: string,
): Promise<LineRecord[]> {
  const res = await apiRequest(
    request,
    'GET',
    `/api/sales/${documentKind}-lines?${documentKind}Id=${encodeURIComponent(documentId)}`,
    { token },
  )
  expect(res.ok(), `GET ${documentKind}-lines failed: ${res.status()}`).toBeTruthy()
  const body = (await readJsonSafe<{ items?: LineRecord[] }>(res)) ?? {}
  return body.items ?? []
}

async function readDocument(
  request: APIRequestContext,
  token: string,
  documentKind: DocumentKind,
  documentId: string,
): Promise<DocumentRecord> {
  const res = await apiRequest(
    request,
    'GET',
    `/api/sales/${documentKind}s?id=${encodeURIComponent(documentId)}`,
    { token },
  )
  expect(res.ok(), `GET ${documentKind} failed: ${res.status()}`).toBeTruthy()
  const body = (await readJsonSafe<{ items?: DocumentRecord[] }>(res)) ?? {}
  expect(body.items, `the ${documentKind} should come back from the list route`).toHaveLength(1)
  return (body.items as DocumentRecord[])[0]
}

function expectGrossOnlyLine(line: LineRecord | undefined, label: string) {
  expect(line, `${label}: the gross-only line should come back from the list route`).toBeTruthy()
  const record = line as LineRecord
  expect(amount(record, 'unit_price_net', 'unitPriceNet'), `${label}: unit net before the discount`).toBeCloseTo(100, 4)
  expect(amount(record, 'total_net_amount', 'totalNetAmount'), `${label}: line net`).toBeCloseTo(90, 4)
  expect(amount(record, 'tax_amount', 'taxAmount'), `${label}: line tax`).toBeCloseTo(20.7, 4)
  expect(amount(record, 'total_gross_amount', 'totalGrossAmount'), `${label}: line gross`).toBeCloseTo(110.7, 4)
}

test.describe('TC-SALES-8232: gross-only discounted lines keep their totals on the next recalculation', () => {
  for (const documentKind of ['order', 'quote'] as const) {
    test(`${documentKind}: adding an untaxed line leaves the gross-only line and the totals unchanged`, async ({ request }) => {
      const token = await getAuthToken(request, 'admin')
      test.skip(!(await canManageSalesOrders(request, token)), 'sales.orders.manage not granted on this tenant')

      let documentId: string | null = null
      try {
        const createRes = await apiRequest(request, 'POST', `/api/sales/${documentKind}s`, {
          token,
          retryTransport: false,
          data: {
            currencyCode: 'USD',
            lines: [{ currencyCode: 'USD', name: `TC-SALES-8232 gross-only line ${Date.now()}`, ...GROSS_ONLY_LINE }],
          },
        })
        expect(createRes.status(), `POST ${documentKind} failed: ${createRes.status()}`).toBe(201)
        const created = await readJsonSafe<{ id?: string }>(createRes)
        documentId = expectId(created?.id, `Created ${documentKind} must have an id`)

        const createdLines = await readLines(request, token, documentKind, documentId)
        expect(createdLines).toHaveLength(1)
        const grossOnlyLineId = createdLines[0].id
        expectGrossOnlyLine(createdLines[0], 'after create')

        const upsertRes = await apiRequest(request, 'POST', `/api/sales/${documentKind}-lines`, {
          token,
          data: {
            [`${documentKind}Id`]: documentId,
            currencyCode: 'USD',
            kind: 'product',
            quantity: 1,
            unitPriceNet: 10,
            unitPriceGross: 10,
            taxRate: 0,
            name: `TC-SALES-8232 untaxed line ${Date.now()}`,
          },
        })
        expect(upsertRes.ok(), `POST ${documentKind}-line failed: ${upsertRes.status()}`).toBeTruthy()

        const linesAfter = await readLines(request, token, documentKind, documentId)
        expect(linesAfter).toHaveLength(2)
        expectGrossOnlyLine(
          linesAfter.find((line) => line.id === grossOnlyLineId),
          'after adding another line',
        )

        const document = await readDocument(request, token, documentKind, documentId)
        expect(amount(document, 'grand_total_net_amount', 'grandTotalNetAmount'), 'document net').toBeCloseTo(100, 4)
        expect(amount(document, 'tax_total_amount', 'taxTotalAmount'), 'document tax').toBeCloseTo(20.7, 4)
        expect(amount(document, 'grand_total_gross_amount', 'grandTotalGrossAmount'), 'document gross').toBeCloseTo(
          120.7,
          4,
        )
      } finally {
        if (documentId) {
          await apiRequest(request, 'DELETE', `/api/sales/${documentKind}s`, {
            token,
            data: { id: documentId },
          }).catch(() => {})
        }
      }
    })
  }
})
