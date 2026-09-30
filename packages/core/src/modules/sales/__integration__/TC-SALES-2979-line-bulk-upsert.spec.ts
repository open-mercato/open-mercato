import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  canManageSalesOrders,
  createOrderLineFixture,
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  expectOperation,
  skipIfUndoTestsDisabled,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-SALES-2979: `POST /api/sales/order-lines/batch` writes a whole order line
 * set in one pass.
 *
 * Spec: `.ai/specs/2026-09-17-sales-order-lines-bulk-upsert.md`
 * Issue: #2979 (the per-line upsert reloads the whole aggregate per call)
 *
 * The route is the only surface from which `sales.orders.lines.upsert_many` can
 * be exercised against a real database, so these cases cover what the unit
 * tests cannot: that one batch reaches Postgres with the same end state as the
 * per-line sequence it replaces, that a refusal leaves nothing behind, and —
 * the one that matters most — that undoing a batch really restores the order's
 * line graph rather than merely asking for a rollback. `restoreOrderGraph`
 * deletes the whole child graph before rebuilding it; only a real database can
 * show the rebuild landed.
 *
 * Two of the batch's properties stay unit-level by construction and are not
 * claimed here: a flush failure injected mid-transaction, and the
 * `sales.document.totals.calculated` emission, which is a server-side lifecycle
 * event with no client broadcast. Both are covered in
 * `commands/__tests__/documents.line-bulk-upsert.test.ts`.
 *
 * Self-contained: every fixture is created through the API and removed in
 * `finally`; nothing depends on seeded or demo data.
 */

const BATCH_PATH = '/api/sales/order-lines/batch'
const LINES_PATH = '/api/sales/order-lines'
const ORDERS_PATH = '/api/sales/orders'
const CURRENCY = 'USD'

type LineRecord = Record<string, unknown>
type OrderRecord = Record<string, unknown>

function num(value: unknown): number {
  return Number(value ?? 0)
}

function lineNumberOf(line: LineRecord): number {
  return num(line.line_number ?? line.lineNumber)
}

function lineNameOf(line: LineRecord): string {
  return String(line.name ?? '')
}

function lineGrossOf(line: LineRecord): number {
  return num(line.total_gross_amount ?? line.totalGrossAmount)
}

function orderGrossOf(order: OrderRecord): number {
  return num(order.grand_total_gross_amount ?? order.grandTotalGrossAmount)
}

function orderNetOf(order: OrderRecord): number {
  return num(order.grand_total_net_amount ?? order.grandTotalNetAmount)
}

function orderLineCountOf(order: OrderRecord): number {
  return num(order.line_item_count ?? order.lineItemCount)
}

/** A line body that prices net === gross at 0% tax, so totals stay arithmetic. */
function body(name: string, quantity: number, unitPrice: number) {
  return {
    currencyCode: CURRENCY,
    name,
    quantity,
    unitPriceNet: unitPrice,
    unitPriceGross: unitPrice,
    taxRate: 0,
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
    `${LINES_PATH}?orderId=${encodeURIComponent(orderId)}&pageSize=100`,
    { token },
  )
  expect(response.ok(), `GET order-lines failed: ${response.status()}`).toBeTruthy()
  const payload = (await readJsonSafe<{ items?: LineRecord[] }>(response)) ?? {}
  return [...(payload.items ?? [])].sort((left, right) => lineNumberOf(left) - lineNumberOf(right))
}

async function readOrder(
  request: APIRequestContext,
  token: string,
  orderId: string,
): Promise<OrderRecord> {
  const response = await apiRequest(
    request,
    'GET',
    `${ORDERS_PATH}?id=${encodeURIComponent(orderId)}`,
    { token },
  )
  expect(response.ok(), `GET orders failed: ${response.status()}`).toBeTruthy()
  const payload = (await readJsonSafe<{ items?: OrderRecord[] }>(response)) ?? {}
  const order = (payload.items ?? []).find((row) => row.id === orderId)
  expect(order, 'the order should come back from the list route').toBeTruthy()
  return order as OrderRecord
}

const SEED_LINE_NAME = '<fixture seed line>'

/**
 * What a line looks like to a reader, with the parts that cannot match across
 * two separately created orders normalised away: the row id, and the fixture
 * seed line's name, which embeds the millisecond it was created at.
 */
function projection(seedId: string) {
  return (line: LineRecord) => ({
    lineNumber: lineNumberOf(line),
    name: line.id === seedId ? SEED_LINE_NAME : lineNameOf(line),
    quantity: num(line.quantity),
    unitPriceNet: num(line.unit_price_net ?? line.unitPriceNet),
    unitPriceGross: num(line.unit_price_gross ?? line.unitPriceGross),
    totalNet: num(line.total_net_amount ?? line.totalNetAmount),
    totalGross: lineGrossOf(line),
  })
}

/** Identity of a line set, stable enough to assert "nothing changed". */
function fingerprint(lines: LineRecord[]): string {
  return JSON.stringify(
    lines
      .map((line) => [line.id, lineNumberOf(line), lineNameOf(line), num(line.quantity), lineGrossOf(line)])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
  )
}

/** Seed an order with the fixture's zero-priced line plus a keeper and a doomed line. */
async function seedOrder(
  request: APIRequestContext,
  token: string,
  names: { keep: string; drop: string },
): Promise<{ orderId: string; keepId: string; dropId: string; seedId: string }> {
  const orderId = await createSalesOrderFixture(request, token, CURRENCY)
  const keepId = await createOrderLineFixture(request, token, orderId, body(names.keep, 2, 10))
  const dropId = await createOrderLineFixture(request, token, orderId, body(names.drop, 1, 25))
  const lines = await readLines(request, token, orderId)
  expect(lines.length, 'seed + two lines before the edit').toBe(3)
  const seedId = lines.find((line) => line.id !== keepId && line.id !== dropId)?.id as string
  expect(seedId, 'the fixture seed line').toBeTruthy()
  return { orderId, keepId, dropId, seedId }
}

test.describe('TC-SALES-2979: bulk order-line upsert over HTTP', () => {
  test('one batch reaches the same end state as the per-line sequence it replaces', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await canManageSalesOrders(request, token)), 'sales.orders.manage not granted on this tenant')

    const stamp = `${Date.now()}`
    const names = { keep: `Keep ${stamp}`, drop: `Drop ${stamp}`, updated: `Keep ${stamp} updated`, added: `Appended ${stamp}` }
    let batchOrderId: string | null = null
    let perLineOrderId: string | null = null

    try {
      const batched = await seedOrder(request, token, names)
      batchOrderId = batched.orderId
      const perLine = await seedOrder(request, token, names)
      perLineOrderId = perLine.orderId

      // One call: delete one line, update another in place, append a third.
      const response = await apiRequest(request, 'POST', BATCH_PATH, {
        token,
        data: {
          orderId: batchOrderId,
          lines: [
            { id: batched.keepId, ...body(names.updated, 5, 10) },
            body(names.added, 1, 7),
          ],
          deleteIds: [batched.dropId],
        },
      })
      expect(response.status(), `batch failed: ${response.status()} ${await response.text()}`).toBe(200)

      const result = (await readJsonSafe<{ orderId?: string; lineIds?: string[] }>(response)) ?? {}
      expect(result.orderId, 'the batch reports the order it wrote').toBe(batchOrderId)
      expect(result.lineIds?.length, 'one id per upserted entry, in input order').toBe(2)
      expect(result.lineIds?.[0], 'an entry carrying an id updates that line in place').toBe(batched.keepId)
      const appendedId = result.lineIds?.[1] as string
      expect(appendedId, 'an entry without an id gets a fresh one').toBeTruthy()
      expect(appendedId).not.toBe(batched.keepId)

      // The same three edits, one command each, in the order the batch applies
      // them: deletes first, then the entries in input order.
      const deleted = await apiRequest(request, 'DELETE', LINES_PATH, {
        token,
        data: { id: perLine.dropId, orderId: perLineOrderId },
      })
      expect(deleted.ok(), `per-line delete failed: ${deleted.status()}`).toBeTruthy()
      const updated = await apiRequest(request, 'PUT', LINES_PATH, {
        token,
        data: { id: perLine.keepId, orderId: perLineOrderId, ...body(names.updated, 5, 10) },
      })
      expect(updated.ok(), `per-line update failed: ${updated.status()}`).toBeTruthy()
      const appended = await apiRequest(request, 'POST', LINES_PATH, {
        token,
        data: { orderId: perLineOrderId, ...body(names.added, 1, 7) },
      })
      expect(appended.ok(), `per-line append failed: ${appended.status()}`).toBeTruthy()

      const batchLines = await readLines(request, token, batchOrderId)
      const perLineLines = await readLines(request, token, perLineOrderId)

      // The claim the command exists to make: N single calls are replaceable by one.
      expect(
        batchLines.map(projection(batched.seedId)),
        'the batch produces the line set the per-line sequence produces',
      ).toEqual(perLineLines.map(projection(perLine.seedId)))

      const batchOrder = await readOrder(request, token, batchOrderId)
      const perLineOrder = await readOrder(request, token, perLineOrderId)
      expect(
        [orderNetOf(batchOrder), orderGrossOf(batchOrder), orderLineCountOf(batchOrder)],
        'the batch produces the order totals the per-line sequence produces',
      ).toEqual([orderNetOf(perLineOrder), orderGrossOf(perLineOrder), orderLineCountOf(perLineOrder)])

      // Structure, independently of the comparison above.
      expect(
        [...batchLines.map((line) => line.id as string)].sort(),
        'the deleted line is gone, the appended one is there, the untouched one survived',
      ).toEqual([batched.seedId, batched.keepId, appendedId].sort())
      expect(batchLines.map(lineNumberOf), 'the surviving set is renumbered 1..n with no gaps').toEqual([1, 2, 3])
      const updatedLine = batchLines.find((line) => line.id === batched.keepId) as LineRecord
      expect(lineNameOf(updatedLine)).toBe(names.updated)
      expect(num(updatedLine.quantity), 'the update applied').toBe(5)
      expect(num(updatedLine.total_net_amount ?? updatedLine.totalNetAmount), 'net follows the new quantity').toBeCloseTo(50, 2)

      // Characterization of a pre-existing gap in the shared upsert path, not of
      // this command: an entry that changes quantity without supplying totals
      // carries the stored row's `totalGrossAmount` into the recalculation, and
      // the calculation engine honours any present gross verbatim — so the
      // line's gross stays at its pre-edit value while its net follows the new
      // quantity. `sales.orders.lines.upsert` does exactly the same thing (the
      // equivalence assertion above is what pins them together). This will fail
      // — by design — once that is fixed, and both paths must move together.
      expect(lineGrossOf(updatedLine), 'gross still reads off the stored row').toBeCloseTo(20, 2)
    } finally {
      await deleteSalesEntityIfExists(request, token, ORDERS_PATH, batchOrderId)
      await deleteSalesEntityIfExists(request, token, ORDERS_PATH, perLineOrderId)
    }
  })

  test('a refused entry aborts the whole batch and writes nothing', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await canManageSalesOrders(request, token)), 'sales.orders.manage not granted on this tenant')

    const stamp = `${Date.now()}`
    let orderId: string | null = null

    try {
      orderId = await createSalesOrderFixture(request, token, CURRENCY)
      const existingId = await createOrderLineFixture(request, token, orderId, body(`Existing ${stamp}`, 2, 10))

      const before = await readLines(request, token, orderId)
      const beforeFingerprint = fingerprint(before)
      const beforeGross = orderGrossOf(await readOrder(request, token, orderId))

      // An unknown line in `deleteIds` refuses the batch — including the upsert
      // that would otherwise have succeeded alongside it.
      const unknownDelete = await apiRequest(request, 'POST', BATCH_PATH, {
        token,
        data: {
          orderId,
          lines: [body(`Never written ${stamp}`, 3, 11)],
          deleteIds: ['00000000-0000-4000-8000-000000000000'],
        },
      })
      expect(unknownDelete.status(), 'an unknown deleteIds entry is a 404').toBe(404)
      expect(fingerprint(await readLines(request, token, orderId)), 'the refused batch wrote nothing').toBe(beforeFingerprint)

      // Emptying the order is refused on the *final* line set.
      const emptyingBatch = await apiRequest(request, 'POST', BATCH_PATH, {
        token,
        data: { orderId, deleteIds: before.map((line) => line.id) },
      })
      expect(emptyingBatch.status(), 'a delete-only batch that empties the order is a 409').toBe(409)
      expect(fingerprint(await readLines(request, token, orderId)), 'the refused batch wrote nothing').toBe(beforeFingerprint)

      // An order id that is not on this tenant never resolves.
      const unknownOrder = await apiRequest(request, 'POST', BATCH_PATH, {
        token,
        data: { orderId: '00000000-0000-4000-8000-000000000001', lines: [body(`Orphan ${stamp}`, 1, 5)] },
      })
      expect(unknownOrder.status(), 'an unknown order id is a 404').toBe(404)

      // A batch carrying neither lines nor deletes is refused by the schema.
      const emptyBatch = await apiRequest(request, 'POST', BATCH_PATH, {
        token,
        data: { orderId, lines: [], deleteIds: [] },
      })
      expect(emptyBatch.status(), 'an empty batch is a 400').toBe(400)

      // The same id upserted and deleted in one call is refused by the schema.
      const conflicting = await apiRequest(request, 'POST', BATCH_PATH, {
        token,
        data: {
          orderId,
          lines: [{ id: existingId, ...body(`Conflicting ${stamp}`, 1, 5) }],
          deleteIds: [existingId],
        },
      })
      expect(conflicting.status(), 'upserting and deleting the same id is a 400').toBe(400)

      expect(fingerprint(await readLines(request, token, orderId)), 'no refusal touched the order').toBe(beforeFingerprint)
      expect(orderGrossOf(await readOrder(request, token, orderId)), 'no refusal moved the totals').toBeCloseTo(beforeGross, 2)
    } finally {
      await deleteSalesEntityIfExists(request, token, ORDERS_PATH, orderId)
    }
  })

  test('undoing a batch restores the prior line set', async ({ request }) => {
    test.slow()
    skipIfUndoTestsDisabled()
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await canManageSalesOrders(request, token)), 'sales.orders.manage not granted on this tenant')

    const stamp = `${Date.now()}`
    let orderId: string | null = null

    try {
      const seeded = await seedOrder(request, token, { keep: `Edited ${stamp}`, drop: `Deleted ${stamp}` })
      orderId = seeded.orderId

      const before = await readLines(request, token, orderId)
      const beforeFingerprint = fingerprint(before)
      const beforeGross = orderGrossOf(await readOrder(request, token, orderId))
      // seed line (0.00) + 2 × 10.00 + 1 × 25.00, all priced on creation.
      expect(beforeGross, 'the order totals before the batch').toBeCloseTo(45, 2)

      const response = await apiRequest(request, 'POST', BATCH_PATH, {
        token,
        data: {
          orderId,
          lines: [
            { id: seeded.keepId, ...body(`Edited ${stamp} after`, 9, 10) },
            body(`Appended ${stamp}`, 1, 3),
          ],
          deleteIds: [seeded.dropId],
        },
      })
      expect(response.status(), `batch failed: ${response.status()} ${await response.text()}`).toBe(200)
      const operation = expectOperation(response, 'sales.orders.lines.upsert_many')
      expect(operation.commandId).toBe('sales.orders.lines.upsert_many')

      const afterBatch = await readLines(request, token, orderId)
      expect(fingerprint(afterBatch), 'the batch changed the line set').not.toBe(beforeFingerprint)
      expect(
        orderGrossOf(await readOrder(request, token, orderId)),
        'the batch moved the order totals',
      ).not.toBeCloseTo(beforeGross, 2)

      await undoOk(request, token, operation.undoToken, 'sales.orders.lines.upsert_many')

      const restored = await readLines(request, token, orderId)
      expect(
        fingerprint(restored),
        'undo restores every line — same ids, numbers, names, quantities and totals',
      ).toBe(beforeFingerprint)
      expect(
        restored.some((line) => lineNameOf(line) === `Appended ${stamp}`),
        'the appended line is gone again',
      ).toBeFalsy()
      expect(
        restored.find((line) => line.id === seeded.dropId),
        'the deleted line is back, under its original id',
      ).toBeTruthy()
      expect(orderGrossOf(await readOrder(request, token, orderId)), 'undo restores the order totals').toBeCloseTo(beforeGross, 2)
    } finally {
      await deleteSalesEntityIfExists(request, token, ORDERS_PATH, orderId)
    }
  })
})
