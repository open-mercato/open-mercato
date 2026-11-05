import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  canManageSalesOrders,
  createOrderLineFixture,
  createSalesOrderFixture,
  createSalesQuoteFixture,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * TC-SALES-6947: PUT order-lines / quote-lines accept a partial update of an
 * existing line.
 *
 * Issue: #6947. A status-only PUT (`{ id, orderId, statusEntryId }`) used to be
 * rejected because PUT validated the body against the full create schema. The
 * upsert command already merges omitted fields from the stored line, so an
 * `id`-bearing PUT now only needs the id and the parent document. A PUT that
 * does not name a stored line of that parent keeps the full create contract.
 *
 * Each case drives the real HTTP surface and reads the persisted line and
 * document header back. Self-contained: statuses, documents and lines are
 * created through the API and removed in `finally`.
 */

type JsonMap = Record<string, unknown>
type DocumentKind = 'order' | 'quote'

const QUANTITY = 3
const UNIT_PRICE_NET = 100
const TAX_RATE = 23
const DISCOUNT_PERCENT = 10
const MISSING_ID = '00000000-0000-4000-8000-000000006947'

const ROUTES: Record<DocumentKind, { lines: string; documents: string; parentKey: 'orderId' | 'quoteId' }> = {
  order: { lines: '/api/sales/order-lines', documents: '/api/sales/orders', parentKey: 'orderId' },
  quote: { lines: '/api/sales/quote-lines', documents: '/api/sales/quotes', parentKey: 'quoteId' },
}

function num(value: unknown): number {
  return Number(value ?? 0)
}

function pick(record: JsonMap, snake: string, camel: string): unknown {
  return record[snake] ?? record[camel]
}

function lineAmounts(line: JsonMap) {
  return {
    quantity: num(line.quantity),
    unitPriceNet: num(pick(line, 'unit_price_net', 'unitPriceNet')),
    discountAmount: num(pick(line, 'discount_amount', 'discountAmount')),
    taxAmount: num(pick(line, 'tax_amount', 'taxAmount')),
    totalNet: num(pick(line, 'total_net_amount', 'totalNetAmount')),
    totalGross: num(pick(line, 'total_gross_amount', 'totalGrossAmount')),
  }
}

function documentTotals(document: JsonMap) {
  return {
    net: num(pick(document, 'grand_total_net_amount', 'grandTotalNetAmount')),
    gross: num(pick(document, 'grand_total_gross_amount', 'grandTotalGrossAmount')),
    discount: num(pick(document, 'discount_total_amount', 'discountTotalAmount')),
    tax: num(pick(document, 'tax_total_amount', 'taxTotalAmount')),
  }
}

async function createLineStatus(request: APIRequestContext, token: string, label: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/sales/order-line-statuses', {
    token,
    data: { value: `qa-6947-${label}-${Date.now()}`, label: `QA 6947 ${label}` },
  })
  expect(response.status(), 'creating a line status should return 201').toBe(201)
  const body = (await readJsonSafe<{ id?: string }>(response)) ?? {}
  expect(typeof body.id).toBe('string')
  return body.id as string
}

async function deleteLineStatus(request: APIRequestContext, token: string, id: string | null) {
  if (!id) return
  await apiRequest(request, 'DELETE', `/api/sales/order-line-statuses?id=${encodeURIComponent(id)}`, {
    token,
  }).catch(() => undefined)
}

async function readLines(
  request: APIRequestContext,
  token: string,
  kind: DocumentKind,
  documentId: string,
): Promise<JsonMap[]> {
  const route = ROUTES[kind]
  const response = await apiRequest(
    request,
    'GET',
    `${route.lines}?${route.parentKey}=${encodeURIComponent(documentId)}&pageSize=100`,
    { token },
  )
  expect(response.status(), `GET ${route.lines} should return 200`).toBe(200)
  const body = (await readJsonSafe<{ items?: JsonMap[] }>(response)) ?? {}
  return body.items ?? []
}

async function readLine(
  request: APIRequestContext,
  token: string,
  kind: DocumentKind,
  documentId: string,
  lineId: string,
): Promise<JsonMap> {
  const line = (await readLines(request, token, kind, documentId)).find((item) => item.id === lineId)
  expect(line, 'the test line should be listed under its document').toBeTruthy()
  return line as JsonMap
}

async function readDocument(
  request: APIRequestContext,
  token: string,
  kind: DocumentKind,
  documentId: string,
): Promise<JsonMap> {
  const route = ROUTES[kind]
  const response = await apiRequest(request, 'GET', `${route.documents}?id=${encodeURIComponent(documentId)}`, {
    token,
  })
  expect(response.status(), `GET ${route.documents} should return 200`).toBe(200)
  const body = (await readJsonSafe<{ items?: JsonMap[] }>(response)) ?? {}
  const document = (body.items ?? []).find((item) => item.id === documentId)
  expect(document, 'the test document should be readable').toBeTruthy()
  return document as JsonMap
}

async function createDocument(request: APIRequestContext, token: string, kind: DocumentKind): Promise<string> {
  return kind === 'order'
    ? createSalesOrderFixture(request, token, 'USD')
    : createSalesQuoteFixture(request, token, 'USD')
}

async function createPricedLine(
  request: APIRequestContext,
  token: string,
  kind: DocumentKind,
  documentId: string,
  statusEntryId: string,
): Promise<string> {
  const line = {
    currencyCode: 'USD',
    kind: 'product',
    quantity: QUANTITY,
    unitPriceNet: UNIT_PRICE_NET,
    unitPriceGross: UNIT_PRICE_NET * (1 + TAX_RATE / 100),
    taxRate: TAX_RATE,
    discountPercent: DISCOUNT_PERCENT,
    statusEntryId,
    comment: 'keep me',
    name: `TC-SALES-6947 ${kind} line ${Date.now()}`,
  }
  if (kind === 'order') return createOrderLineFixture(request, token, documentId, line)
  const response = await apiRequest(request, 'POST', ROUTES.quote.lines, {
    token,
    data: { quoteId: documentId, ...line },
  })
  expect(response.status(), 'POST quote-line should return 201').toBe(201)
  const body = (await readJsonSafe<JsonMap>(response)) ?? {}
  expect(typeof body.id).toBe('string')
  return body.id as string
}

async function putLine(
  request: APIRequestContext,
  token: string,
  kind: DocumentKind,
  data: JsonMap,
  headers?: Record<string, string>,
) {
  return apiRequest(request, 'PUT', ROUTES[kind].lines, { token, data, headers })
}

async function deleteDocument(request: APIRequestContext, token: string, kind: DocumentKind, id: string | null) {
  if (!id) return
  await apiRequest(request, 'DELETE', ROUTES[kind].documents, { token, data: { id } }).catch(() => undefined)
}

function updatedAtOf(document: JsonMap): string {
  const raw = pick(document, 'updated_at', 'updatedAt')
  expect(typeof raw, 'documents expose updated_at').toBe('string')
  return new Date(Date.parse(raw as string)).toISOString()
}

for (const kind of ['order', 'quote'] as const) {
  const parentKey = ROUTES[kind].parentKey

  test.describe(`TC-SALES-6947: partial PUT of ${kind} lines`, () => {
    test(`a status-only PUT changes just the status and keeps line and ${kind} totals`, async ({ request }) => {
      const token = await getAuthToken(request, 'admin')
      test.skip(!(await canManageSalesOrders(request, token)), 'sales management not granted on this tenant')
      let documentId: string | null = null
      let oldStatusId: string | null = null
      let newStatusId: string | null = null
      try {
        oldStatusId = await createLineStatus(request, token, 'old')
        newStatusId = await createLineStatus(request, token, 'new')
        documentId = await createDocument(request, token, kind)
        const lineId = await createPricedLine(request, token, kind, documentId, oldStatusId)

        const beforeLine = await readLine(request, token, kind, documentId, lineId)
        const beforeTotals = documentTotals(await readDocument(request, token, kind, documentId))
        expect(lineAmounts(beforeLine).discountAmount, 'the seeded line carries a discount').toBeGreaterThan(0)
        expect(lineAmounts(beforeLine).taxAmount, 'the seeded line carries tax').toBeGreaterThan(0)

        // Two passes: the second proves the partial update is idempotent.
        for (let pass = 1; pass <= 2; pass += 1) {
          const response = await putLine(request, token, kind, {
            id: lineId,
            [parentKey]: documentId,
            statusEntryId: newStatusId,
          })
          const text = await response.text()
          expect(response.status(), `pass ${pass}: status-only PUT should succeed: ${text.slice(0, 300)}`).toBe(200)
          expect((JSON.parse(text) as JsonMap).id).toBe(lineId)

          const afterLine = await readLine(request, token, kind, documentId, lineId)
          expect(pick(afterLine, 'status_entry_id', 'statusEntryId')).toBe(newStatusId)
          expect(afterLine.comment).toBe('keep me')
          expect(afterLine.name).toBe(beforeLine.name)
          const before = lineAmounts(beforeLine)
          const after = lineAmounts(afterLine)
          for (const key of Object.keys(before) as Array<keyof typeof before>) {
            expect(after[key], `pass ${pass}: line ${key} must not change`).toBeCloseTo(before[key], 4)
          }
          const afterTotals = documentTotals(await readDocument(request, token, kind, documentId))
          for (const key of Object.keys(beforeTotals) as Array<keyof typeof beforeTotals>) {
            expect(afterTotals[key], `pass ${pass}: ${kind} ${key} total must not change`).toBeCloseTo(
              beforeTotals[key],
              4,
            )
          }
        }
      } finally {
        await deleteDocument(request, token, kind, documentId)
        await deleteLineStatus(request, token, oldStatusId)
        await deleteLineStatus(request, token, newStatusId)
      }
    })

    test(`a partial PUT that names no stored line of the ${kind} is refused`, async ({ request }) => {
      const token = await getAuthToken(request, 'admin')
      test.skip(!(await canManageSalesOrders(request, token)), 'sales management not granted on this tenant')
      let documentId: string | null = null
      let otherDocumentId: string | null = null
      let oldStatusId: string | null = null
      let newStatusId: string | null = null
      try {
        oldStatusId = await createLineStatus(request, token, 'old')
        newStatusId = await createLineStatus(request, token, 'new')
        documentId = await createDocument(request, token, kind)
        otherDocumentId = await createDocument(request, token, kind)
        const lineId = await createPricedLine(request, token, kind, documentId, oldStatusId)
        const linesBefore = (await readLines(request, token, kind, documentId)).length
        const otherLinesBefore = (await readLines(request, token, kind, otherDocumentId)).length

        // Unknown line id: the full create contract applies, so the partial body fails validation.
        const unknown = await putLine(request, token, kind, {
          id: MISSING_ID,
          [parentKey]: documentId,
          statusEntryId: newStatusId,
        })
        expect(unknown.status(), 'a partial PUT for an unknown line id should return 400').toBe(400)

        // Existing line, wrong parent: it is not a line of that document, so the same refusal applies.
        const wrongParent = await putLine(request, token, kind, {
          id: lineId,
          [parentKey]: otherDocumentId,
          statusEntryId: newStatusId,
        })
        expect(wrongParent.status(), 'a partial PUT under another document should return 400').toBe(400)

        // Parent outside the caller's scope (no such document): refused before any write.
        const missingParent = await putLine(request, token, kind, {
          id: lineId,
          [parentKey]: MISSING_ID,
          statusEntryId: newStatusId,
        })
        expect(missingParent.status(), 'a partial PUT under an inaccessible document should fail').toBeGreaterThanOrEqual(
          400,
        )
        expect(missingParent.status()).toBeLessThan(500)

        expect(await readLines(request, token, kind, documentId)).toHaveLength(linesBefore)
        expect(await readLines(request, token, kind, otherDocumentId)).toHaveLength(otherLinesBefore)
        const line = await readLine(request, token, kind, documentId, lineId)
        expect(pick(line, 'status_entry_id', 'statusEntryId'), 'refused PUTs must not touch the line').toBe(
          oldStatusId,
        )
      } finally {
        await deleteDocument(request, token, kind, documentId)
        await deleteDocument(request, token, kind, otherDocumentId)
        await deleteLineStatus(request, token, oldStatusId)
        await deleteLineStatus(request, token, newStatusId)
      }
    })

    test(`a partial PUT with a stale ${kind} version is refused`, async ({ request }) => {
      const token = await getAuthToken(request, 'admin')
      test.skip(!(await canManageSalesOrders(request, token)), 'sales management not granted on this tenant')
      let documentId: string | null = null
      let oldStatusId: string | null = null
      let newStatusId: string | null = null
      try {
        oldStatusId = await createLineStatus(request, token, 'old')
        newStatusId = await createLineStatus(request, token, 'new')
        documentId = await createDocument(request, token, kind)
        const lineId = await createPricedLine(request, token, kind, documentId, oldStatusId)
        const staleVersion = updatedAtOf(await readDocument(request, token, kind, documentId))

        // Advance the document version with a second line.
        await createPricedLine(request, token, kind, documentId, oldStatusId)
        const freshVersion = updatedAtOf(await readDocument(request, token, kind, documentId))
        expect(freshVersion, `adding a line should advance the ${kind} version`).not.toBe(staleVersion)

        const body = { id: lineId, [parentKey]: documentId, statusEntryId: newStatusId }
        const conflict = await putLine(request, token, kind, body, { [OPTIMISTIC_LOCK_HEADER_NAME]: staleVersion })
        expect(conflict.status(), 'a stale parent version should return 409').toBe(409)
        expect(((await readJsonSafe<JsonMap>(conflict)) ?? {}).code).toBe(OPTIMISTIC_LOCK_CONFLICT_CODE)
        const untouched = await readLine(request, token, kind, documentId, lineId)
        expect(pick(untouched, 'status_entry_id', 'statusEntryId')).toBe(oldStatusId)

        const accepted = await putLine(request, token, kind, body, { [OPTIMISTIC_LOCK_HEADER_NAME]: freshVersion })
        expect(accepted.status(), 'the current parent version should be accepted').toBe(200)
        const updated = await readLine(request, token, kind, documentId, lineId)
        expect(pick(updated, 'status_entry_id', 'statusEntryId')).toBe(newStatusId)
      } finally {
        await deleteDocument(request, token, kind, documentId)
        await deleteLineStatus(request, token, oldStatusId)
        await deleteLineStatus(request, token, newStatusId)
      }
    })
  })
}
