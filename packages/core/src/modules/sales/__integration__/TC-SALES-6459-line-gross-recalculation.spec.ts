import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

type DocumentKind = 'order' | 'quote'
type LineAmounts = {
  id: string
  quantity: string
  total_net_amount: string
  total_gross_amount: string
  tax_amount: string
}
type DocumentAmounts = {
  grandTotalNetAmount: number
  grandTotalGrossAmount: number
  taxTotalAmount: number
}

async function readAmounts(
  request: APIRequestContext,
  token: string,
  documentKind: DocumentKind,
  documentId: string,
) {
  const linesResponse = await apiRequest(
    request, 'GET', `/api/sales/${documentKind}-lines?${documentKind}Id=${documentId}`, { token },
  )
  expect(linesResponse.status()).toBe(200)
  const lines = await readJsonSafe<{ items: LineAmounts[] }>(linesResponse)
  expect(lines?.items).toHaveLength(1)

  const documentResponse = await apiRequest(
    request, 'GET', `/api/sales/${documentKind}s?id=${documentId}`, { token },
  )
  expect(documentResponse.status()).toBe(200)
  const documents = await readJsonSafe<{ items: DocumentAmounts[] }>(documentResponse)
  expect(documents?.items).toHaveLength(1)
  return { line: lines!.items[0], document: documents!.items[0] }
}

function expectAmounts(
  amounts: Awaited<ReturnType<typeof readAmounts>>,
  quantity: number,
  taxRate: number,
) {
  const net = quantity * 10
  const tax = net * taxRate / 100
  expect(Number(amounts.line.quantity)).toBe(quantity)
  expect(Number(amounts.line.total_net_amount)).toBe(net)
  expect(Number(amounts.line.total_gross_amount)).toBe(net + tax)
  expect(Number(amounts.line.tax_amount)).toBe(tax)
  expect(amounts.document.grandTotalNetAmount).toBe(net)
  expect(amounts.document.grandTotalGrossAmount).toBe(net + tax)
  expect(amounts.document.taxTotalAmount).toBe(tax)
}

test.describe('TC-SALES-6459 line quantity recalculation persists net, gross, and tax', () => {
  for (const documentKind of ['order', 'quote'] as const) {
    for (const taxRate of [0, 20]) {
      test(`${documentKind} at ${taxRate}% tax rejects invalid edits and preserves retry totals`, async ({ request }) => {
        const token = await getAuthToken(request, 'admin')
        let documentId: string | null = null
        try {
          const createResponse = await apiRequest(request, 'POST', `/api/sales/${documentKind}s`, {
            token,
            retryTransport: false,
            data: {
              currencyCode: 'USD',
              lines: [{
                currencyCode: 'USD', name: 'Quantity recalculation regression', quantity: 2,
                unitPriceNet: 10, unitPriceGross: 10 * (1 + taxRate / 100), taxRate,
              }],
            },
          })
          expect(createResponse.status()).toBe(201)
          const created = await readJsonSafe<{ id: string }>(createResponse)
          documentId = expectId(created?.id, 'Created document must have an id')
          const before = await readAmounts(request, token, documentKind, documentId)
          expectAmounts(before, 2, taxRate)
          const payload = {
            id: before.line.id, [`${documentKind}Id`]: documentId, currencyCode: 'USD',
            unitPriceNet: 10, unitPriceGross: 10 * (1 + taxRate / 100), taxRate,
          }

          const refused = await apiRequest(request, 'PUT', `/api/sales/${documentKind}-lines`, {
            token, data: { ...payload, quantity: -1 },
          })
          expect(refused.status()).toBe(400)
          expectAmounts(await readAmounts(request, token, documentKind, documentId), 2, taxRate)

          for (let attempt = 0; attempt < 2; attempt += 1) {
            const updated = await apiRequest(request, 'PUT', `/api/sales/${documentKind}-lines`, {
              token, data: { ...payload, quantity: 5 },
            })
            expect(updated.status()).toBe(200)
            expectAmounts(await readAmounts(request, token, documentKind, documentId), 5, taxRate)
          }
        } finally {
          await deleteSalesEntityIfExists(request, token, `/api/sales/${documentKind}s`, documentId)
        }
      })
    }
  }
})
