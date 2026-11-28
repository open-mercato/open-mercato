import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createOrderLineFixture,
  createSalesOrderFixture,
  createSalesQuoteFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'

type LineInput = {
  name: string
  quantity: number
  unitPriceNet: number
}

type LineRecord = {
  id: string
  name: string
  line_number: number
  quantity: string | number
  unit_price_net: string | number
  total_net_amount: string | number
  total_gross_amount: string | number
}

type OrderRecord = {
  id: string
  lineItemCount: number
  grandTotalNetAmount: number
  grandTotalGrossAmount: number
}

type DocumentKind = 'order' | 'quote'

type AdjustmentRecord = {
  id: string
  kind: string
  amount_net: string | number
  amount_gross: string | number
}

function linePayload(input: LineInput) {
  const total = input.quantity * input.unitPriceNet
  return {
    ...input,
    currencyCode: 'USD',
    unitPriceGross: input.unitPriceNet,
    taxRate: 0,
    totalNetAmount: total,
    totalGrossAmount: total,
  }
}

async function runParallel(operations: Promise<void>[]): Promise<void> {
  const results = await Promise.allSettled(operations)
  for (const result of results) {
    if (result.status === 'rejected') throw result.reason
  }
}

async function readLines(
  request: APIRequestContext,
  token: string,
  orderId: string,
): Promise<LineRecord[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/sales/order-lines?orderId=${encodeURIComponent(orderId)}&pageSize=100`,
    { token },
  )
  expect(response.status(), 'the stored order lines should be readable').toBe(200)
  const body = await readJsonSafe<{ items: LineRecord[] }>(response)
  expect(Array.isArray(body?.items)).toBe(true)
  return body?.items ?? []
}

async function assertStoredState(
  request: APIRequestContext,
  token: string,
  orderId: string,
  expectedLines: Map<string, LineInput>,
): Promise<LineRecord[]> {
  const [lines, response] = await Promise.all([
    readLines(request, token, orderId),
    apiRequest(request, 'GET', `/api/sales/orders?id=${encodeURIComponent(orderId)}`, { token }),
  ])
  expect(response.status(), 'the stored order totals should be readable').toBe(200)
  const body = await readJsonSafe<{ items: OrderRecord[] }>(response)
  const order = body?.items.find((item) => item.id === orderId)
  expect(order, 'the response should contain the test-owned order').toBeTruthy()
  if (!order) throw new Error('[internal] Test-owned order missing from response')

  expect(lines).toHaveLength(expectedLines.size)
  expect(lines.map((line) => line.id).sort()).toEqual([...expectedLines.keys()].sort())
  expect(lines.map((line) => line.line_number).sort((first, second) => first - second)).toEqual(
    Array.from({ length: expectedLines.size }, (_, index) => index + 1),
  )

  for (const line of lines) {
    const expectedLine = expectedLines.get(line.id)
    if (!expectedLine) throw new Error('[internal] Unexpected order line in response')
    expect(line.name).toBe(expectedLine.name)
    expect(Number(line.quantity)).toBe(expectedLine.quantity)
    expect(Number(line.unit_price_net)).toBe(expectedLine.unitPriceNet)
    const expectedTotal = expectedLine.quantity * expectedLine.unitPriceNet
    expect(Number(line.total_net_amount)).toBeCloseTo(expectedTotal, 2)
    expect(Number(line.total_gross_amount)).toBeCloseTo(expectedTotal, 2)
  }

  const netSum = lines.reduce((total, line) => total + Number(line.total_net_amount), 0)
  const grossSum = lines.reduce((total, line) => total + Number(line.total_gross_amount), 0)
  expect(order.lineItemCount).toBe(lines.length)
  expect(order.grandTotalNetAmount).toBeCloseTo(netSum, 2)
  expect(order.grandTotalGrossAmount).toBeCloseTo(grossSum, 2)
  return lines
}

test.describe('TC-SALES-6463: concurrent order-line mutations', () => {
  test('parallel appends, edits, and deletes preserve every line and the stored totals', async ({ request }) => {
    const token = await getAuthToken(request, 'admin', process.env.TEST_ADMIN_PASSWORD)
    let orderId: string | null = null

    try {
      const createdOrderId = await createSalesOrderFixture(request, token, 'USD')
      orderId = createdOrderId
      const seedLines = await readLines(request, token, createdOrderId)
      expect(seedLines).toHaveLength(1)
      const seedLine = seedLines[0]
      const expectedLines = new Map<string, LineInput>([
        [seedLine.id, { name: seedLine.name, quantity: 1, unitPriceNet: 0 }],
      ])
      const stamp = Date.now()

      const appendLine = async (input: LineInput): Promise<void> => {
        const lineId = await createOrderLineFixture(request, token, createdOrderId, linePayload(input))
        expectedLines.set(lineId, input)
      }

      await runParallel(
        Array.from({ length: 8 }, (_, index) =>
          appendLine({
            name: `TC-SALES-6463 ${stamp} append ${index}`,
            quantity: index + 1,
            unitPriceNet: index + 11,
          }),
        ),
      )
      const appendedLines = await assertStoredState(request, token, createdOrderId, expectedLines)
      const originalNumbers = new Map(appendedLines.map((line) => [line.id, line.line_number]))

      await runParallel(
        [...expectedLines.entries()]
          .filter(([lineId]) => lineId !== seedLine.id)
          .map(async ([lineId, before]) => {
            const input = {
              name: `${before.name} edited`,
              quantity: before.quantity + 2,
              unitPriceNet: before.unitPriceNet + 9,
            }
            const response = await apiRequest(request, 'PUT', '/api/sales/order-lines', {
              token,
              retryTransport: false,
              data: { id: lineId, orderId: createdOrderId, ...linePayload(input) },
            })
            expect(response.status(), `editing line ${lineId} should succeed`).toBe(200)
            expectedLines.set(lineId, input)
          }),
      )
      const editedLines = await assertStoredState(request, token, createdOrderId, expectedLines)
      for (const line of editedLines) {
        expect(line.line_number, 'editing a line should preserve its position').toBe(originalNumbers.get(line.id))
      }

      const deletedIds = editedLines.filter((line) => line.id !== seedLine.id).slice(0, 3).map((line) => line.id)
      await runParallel([
        ...deletedIds.map(async (lineId) => {
          const response = await apiRequest(request, 'DELETE', '/api/sales/order-lines', {
            token,
            retryTransport: false,
            data: { id: lineId, orderId: createdOrderId },
          })
          expect(response.status(), `deleting line ${lineId} should succeed`).toBe(200)
          expectedLines.delete(lineId)
        }),
        ...Array.from({ length: 3 }, (_, index) =>
          appendLine({
            name: `TC-SALES-6463 ${stamp} replacement ${index}`,
            quantity: index + 3,
            unitPriceNet: index + 31,
          }),
        ),
      ])
      await assertStoredState(request, token, createdOrderId, expectedLines)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})

async function createDocumentLine(
  request: APIRequestContext,
  token: string,
  kind: DocumentKind,
  documentId: string,
  input: LineInput,
): Promise<string> {
  const response = await apiRequest(request, 'POST', `/api/sales/${kind}-lines`, {
    token,
    retryTransport: false,
    data: { [`${kind}Id`]: documentId, ...linePayload(input) },
  })
  expect(response.status(), `appending a ${kind} line should succeed`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(typeof body?.id, `the ${kind} line create should return an id`).toBe('string')
  return body?.id ?? ''
}

async function createSurcharge(
  request: APIRequestContext,
  token: string,
  kind: DocumentKind,
  documentId: string,
  amount: number,
): Promise<string> {
  const response = await apiRequest(request, 'POST', `/api/sales/${kind}-adjustments`, {
    token,
    retryTransport: false,
    data: {
      [`${kind}Id`]: documentId,
      scope: 'order',
      kind: 'surcharge',
      label: `TC-SALES-6463 surcharge ${amount}`,
      amountNet: amount,
      amountGross: amount,
      currencyCode: 'USD',
    },
  })
  expect(response.status(), `adding a ${kind} surcharge should succeed`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(typeof body?.id, `the ${kind} surcharge create should return an id`).toBe('string')
  return body?.id ?? ''
}

async function deleteDocumentChild(
  request: APIRequestContext,
  token: string,
  kind: DocumentKind,
  resource: 'lines' | 'adjustments',
  documentId: string,
  childId: string,
): Promise<void> {
  const response = await apiRequest(request, 'DELETE', `/api/sales/${kind}-${resource}`, {
    token,
    retryTransport: false,
    data: { id: childId, [`${kind}Id`]: documentId },
  })
  expect(response.status(), `deleting ${kind} ${resource} ${childId} should succeed`).toBe(200)
}

async function listDocumentChildren<TRecord>(
  request: APIRequestContext,
  token: string,
  kind: DocumentKind,
  resource: 'lines' | 'adjustments',
  documentId: string,
): Promise<TRecord[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/sales/${kind}-${resource}?${kind}Id=${encodeURIComponent(documentId)}&pageSize=100`,
    { token },
  )
  expect(response.status(), `the stored ${kind} ${resource} should be readable`).toBe(200)
  const body = await readJsonSafe<{ items: TRecord[] }>(response)
  expect(Array.isArray(body?.items)).toBe(true)
  return body?.items ?? []
}

async function assertHeaderMatchesRows(
  request: APIRequestContext,
  token: string,
  kind: DocumentKind,
  documentId: string,
  expectedLineIds: Set<string>,
  expectedSurcharges: Map<string, number>,
): Promise<void> {
  const [lines, adjustments, response] = await Promise.all([
    listDocumentChildren<LineRecord>(request, token, kind, 'lines', documentId),
    listDocumentChildren<AdjustmentRecord>(request, token, kind, 'adjustments', documentId),
    apiRequest(request, 'GET', `/api/sales/${kind}s?id=${encodeURIComponent(documentId)}`, { token }),
  ])
  expect(response.status(), `the stored ${kind} totals should be readable`).toBe(200)
  const body = await readJsonSafe<{ items: OrderRecord[] }>(response)
  const header = body?.items.find((item) => item.id === documentId)
  expect(header, `the response should contain the test-owned ${kind}`).toBeTruthy()
  if (!header) throw new Error(`[internal] Test-owned ${kind} missing from response`)

  expect(lines.map((line) => line.id).sort()).toEqual([...expectedLineIds].sort())
  expect(lines.map((line) => line.line_number).sort((first, second) => first - second)).toEqual(
    Array.from({ length: expectedLineIds.size }, (_, index) => index + 1),
  )
  expect(adjustments.map((adjustment) => adjustment.id).sort()).toEqual([...expectedSurcharges.keys()].sort())
  for (const adjustment of adjustments) {
    expect(Number(adjustment.amount_net)).toBeCloseTo(expectedSurcharges.get(adjustment.id) ?? Number.NaN, 2)
  }

  const surchargeTotal = [...expectedSurcharges.values()].reduce((total, amount) => total + amount, 0)
  const netSum = lines.reduce((total, line) => total + Number(line.total_net_amount), 0)
  const grossSum = lines.reduce((total, line) => total + Number(line.total_gross_amount), 0)
  expect(header.lineItemCount).toBe(lines.length)
  expect(header.grandTotalNetAmount).toBeCloseTo(netSum + surchargeTotal, 2)
  expect(header.grandTotalGrossAmount).toBeCloseTo(grossSum + surchargeTotal, 2)
}

async function exerciseParallelHeaderWriters(
  request: APIRequestContext,
  token: string,
  kind: DocumentKind,
  documentId: string,
  initialLineIds: string[],
): Promise<void> {
  const stamp = Date.now()
  const lineIds = new Set(initialLineIds)
  const surcharges = new Map<string, number>()
  const appendLine = async (index: number, label: string): Promise<void> => {
    const lineId = await createDocumentLine(request, token, kind, documentId, {
      name: `TC-SALES-6463 ${stamp} ${kind} ${label} ${index}`,
      quantity: index + 1,
      unitPriceNet: index + 13,
    })
    lineIds.add(lineId)
  }
  const addSurcharge = async (amount: number): Promise<void> => {
    surcharges.set(await createSurcharge(request, token, kind, documentId, amount), amount)
  }

  await runParallel([
    ...Array.from({ length: 5 }, (_, index) => appendLine(index, 'append')),
    ...[2, 3, 4].map(addSurcharge),
  ])
  await assertHeaderMatchesRows(request, token, kind, documentId, lineIds, surcharges)

  const removedSurcharges = [...surcharges.keys()].slice(0, 2)
  const removedLines = [...lineIds].filter((lineId) => !initialLineIds.includes(lineId)).slice(0, 2)
  await runParallel([
    ...removedSurcharges.map(async (adjustmentId) => {
      await deleteDocumentChild(request, token, kind, 'adjustments', documentId, adjustmentId)
      surcharges.delete(adjustmentId)
    }),
    ...removedLines.map(async (lineId) => {
      await deleteDocumentChild(request, token, kind, 'lines', documentId, lineId)
      lineIds.delete(lineId)
    }),
    ...Array.from({ length: 3 }, (_, index) => appendLine(index, 'replacement')),
    addSurcharge(5),
  ])
  await assertHeaderMatchesRows(request, token, kind, documentId, lineIds, surcharges)
}

test.describe('TC-SALES-6463: concurrent line and adjustment writes share the parent document lock', () => {
  test('parallel order line and surcharge writes keep the order header equal to its stored rows', async ({ request }) => {
    const token = await getAuthToken(request, 'admin', process.env.TEST_ADMIN_PASSWORD)
    let orderId: string | null = null

    try {
      const createdOrderId = await createSalesOrderFixture(request, token, 'USD')
      orderId = createdOrderId
      const seedLines = await readLines(request, token, createdOrderId)
      expect(seedLines).toHaveLength(1)
      await exerciseParallelHeaderWriters(request, token, 'order', createdOrderId, seedLines.map((line) => line.id))
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('parallel quote line and surcharge writes keep the quote header equal to its stored rows', async ({ request }) => {
    const token = await getAuthToken(request, 'admin', process.env.TEST_ADMIN_PASSWORD)
    let quoteId: string | null = null

    try {
      const createdQuoteId = await createSalesQuoteFixture(request, token, 'USD')
      quoteId = createdQuoteId
      await exerciseParallelHeaderWriters(request, token, 'quote', createdQuoteId, [])
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    }
  })
})
