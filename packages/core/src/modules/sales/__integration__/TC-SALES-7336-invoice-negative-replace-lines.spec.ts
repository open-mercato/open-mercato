import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient, type IntegrationDbClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { createSalesOrderFixture, deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import {
  expectOperation,
  redoByLogId,
  skipIfUndoTestsDisabled,
  undoByToken,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-SALES-7336 — negative invoice amounts and line replacement (Phases 2 and 3 of
 * `.ai/specs/2026-11-06-sales-invoice-import-write-path.md`).
 *
 * No API response carries invoice lines, so lines are read from the database.
 */

const INVOICES = '/api/sales/invoices'
const ACTIONS = '/api/audit_logs/audit-logs/actions'

type JsonMap = Record<string, unknown>
type StoredLine = {
  id: string
  kind: string
  total_net_amount: string
  total_gross_amount: string
  unit_price_net: string
  order_line_id: string | null
}

const UNKNOWN_ORDER_LINE_ID = '00000000-0000-4000-8000-000000000001'

const totals = {
  subtotalNetAmount: 90,
  subtotalGrossAmount: 110.7,
  taxTotalAmount: 20.7,
  grandTotalNetAmount: 90,
  grandTotalGrossAmount: 110.7,
}

const productLine = { quantity: 1, currencyCode: 'EUR', name: 'Product', totalNetAmount: 100, totalGrossAmount: 123 }
const discountLine = {
  quantity: 1,
  currencyCode: 'EUR',
  kind: 'discount',
  name: 'Discount',
  unitPriceNet: -10,
  totalNetAmount: -10,
  totalGrossAmount: -12.3,
}

/**
 * Polls, from the connection that holds the lock, until `expected` other backends
 * wait on it, directly or behind another waiter, so a test proves the requests
 * really contended instead of trusting a fixed sleep. Waiters on unrelated locks
 * from parallel workers are not counted.
 */
async function waitForLockWaiters(client: IntegrationDbClient, expected: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const result = await client.query<{ waiting: string }>(
      `with direct as (
         select pid from pg_stat_activity
          where datname = current_database() and pg_blocking_pids(pid) && array[pg_backend_pid()]
       )
       select count(*)::text as waiting from pg_stat_activity
        where datname = current_database()
          and wait_event_type = 'Lock'
          and pg_blocking_pids(pid) && (array[pg_backend_pid()] || array(select pid from direct))`,
    )
    if (Number(result.rows[0]?.waiting ?? 0) >= expected) return
    if (Date.now() > deadline) throw new Error(`expected ${expected} lock waiter(s) within ${timeoutMs}ms`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function readLines(invoiceId: string): Promise<StoredLine[]> {
  return withClient(async (client) => {
    const result = await client.query<StoredLine>(
      `select id, kind, total_net_amount::text, total_gross_amount::text, unit_price_net::text, order_line_id
         from sales_invoice_lines where invoice_id = $1 order by line_number asc, id asc`,
      [invoiceId],
    )
    return result.rows
  })
}

type LoggedLineSnapshot = { lines?: Array<{ id: string }> } | null

async function readUpdateSnapshots(
  request: APIRequestContext,
  token: string,
  invoiceId: string,
  logId: string,
): Promise<{ before: string[]; after: string[] }> {
  const query = new URLSearchParams({ resourceId: invoiceId, pageSize: '50' }).toString()
  const response = await apiRequest(request, 'GET', `${ACTIONS}?${query}`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items?: Array<{ id: string; snapshotBefore: unknown; snapshotAfter: unknown }> }>(response)
  const entry = body?.items?.find((item) => item.id === logId)
  expect(entry, `action log ${logId} should be listed for the invoice`).toBeTruthy()
  const lineIds = (snapshot: unknown) => ((snapshot as LoggedLineSnapshot)?.lines ?? []).map((line) => line.id).sort()
  return { before: lineIds(entry?.snapshotBefore), after: lineIds(entry?.snapshotAfter) }
}

async function readInvoice(request: APIRequestContext, token: string, id: string): Promise<JsonMap | undefined> {
  const response = await apiRequest(request, 'GET', `${INVOICES}?id=${encodeURIComponent(id)}`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items?: JsonMap[] }>(response)
  return body?.items?.find((item) => item.id === id)
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function amount(record: JsonMap | undefined, camel: string, snake: string): number {
  return Number(record?.[camel] ?? record?.[snake])
}

async function createInvoice(request: APIRequestContext, token: string, data: JsonMap): Promise<string> {
  const response = await apiRequest(request, 'POST', INVOICES, { token, data: { currencyCode: 'EUR', ...data } })
  expect(response.status(), `POST /api/sales/invoices should be 201, got ${response.status()}`).toBe(201)
  const body = await readJsonSafe<{ invoiceId?: string; id?: string }>(response)
  const invoiceId = body?.invoiceId ?? body?.id ?? null
  expect(typeof invoiceId).toBe('string')
  return invoiceId as string
}

async function purgeInvoice(invoiceId: string | null): Promise<void> {
  if (!invoiceId) return
  await withClient(async (client) => {
    await client.query('delete from sales_invoice_lines where invoice_id = $1', [invoiceId])
    await client.query('delete from custom_field_values where record_id = $1', [invoiceId])
    await client.query('delete from sales_invoices where id = $1', [invoiceId])
  })
}

test.describe('TC-SALES-7336: negative invoice amounts and line replacement', () => {
  test('stores a negative discount line and negative net and tax header amounts as sent', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let invoiceId: string | null = null
    try {
      invoiceId = await createInvoice(request, token, {
        lines: [productLine, { ...discountLine, taxAmount: -2.3 }],
        subtotalNetAmount: -5,
        subtotalGrossAmount: 110.7,
        taxTotalAmount: -1,
        grandTotalNetAmount: -5,
        grandTotalGrossAmount: 110.7,
      })
      const lines = await readLines(invoiceId)
      expect(lines.map((line) => [line.kind, Number(line.total_net_amount), Number(line.total_gross_amount)])).toEqual([
        ['product', 100, 123],
        ['discount', -10, -12.3],
      ])
      const invoice = await readInvoice(request, token, invoiceId)
      expect(amount(invoice, 'taxTotalAmount', 'tax_total_amount')).toBe(-1)
      expect(amount(invoice, 'grandTotalNetAmount', 'grand_total_net_amount')).toBe(-5)
    } finally {
      await purgeInvoice(invoiceId)
    }
  })

  test('rejects amounts that stay non-negative and incomplete negative lines', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const rejected: Array<[string, JsonMap]> = [
      ['negative quantity', { lines: [{ ...productLine, quantity: -1 }] }],
      ['negative discountAmount', { lines: [{ ...productLine, discountAmount: -1 }] }],
      ['negative line without its gross', { lines: [{ quantity: 1, currencyCode: 'EUR', totalNetAmount: -1 }] }],
      ['negative line with net <= 0 and positive gross', { lines: [{ ...discountLine, totalGrossAmount: 5 }] }],
      ['negative grandTotalGrossAmount', { grandTotalGrossAmount: -1 }],
      ['negative subtotalGrossAmount', { subtotalGrossAmount: -1 }],
      ['an unknown order line', { lines: [{ ...productLine, orderLineId: UNKNOWN_ORDER_LINE_ID }] }],
    ]
    for (const [label, data] of rejected) {
      const response = await apiRequest(request, 'POST', INVOICES, { token, data: { currencyCode: 'EUR', ...data } })
      if (response.status() === 201) {
        const body = await readJsonSafe<{ invoiceId?: string; id?: string }>(response)
        await purgeInvoice(body?.invoiceId ?? body?.id ?? null)
      }
      expect(response.status(), `${label} should be rejected`).toBe(400)
    }
  })

  test('rejects a live order line from another organization', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null
    let orderLine: { id: string; organization_id: string } | null = null
    try {
      orderId = await createSalesOrderFixture(request, token, 'EUR')
      orderLine = await withClient(async (client) => {
        const result = await client.query<{ id: string; organization_id: string }>(
          'select id, organization_id from sales_order_lines where order_id = $1',
          [orderId],
        )
        const row = result.rows[0] ?? null
        if (row) {
          await client.query('update sales_order_lines set organization_id = gen_random_uuid() where id = $1', [row.id])
        }
        return row
      })
      expect(orderLine, 'the order fixture should have a line').toBeTruthy()

      const response = await apiRequest(request, 'POST', INVOICES, {
        token,
        data: { currencyCode: 'EUR', lines: [{ ...productLine, orderLineId: orderLine?.id }] },
      })
      if (response.status() === 201) {
        const body = await readJsonSafe<{ invoiceId?: string; id?: string }>(response)
        await purgeInvoice(body?.invoiceId ?? body?.id ?? null)
      }
      expect(response.status(), 'an order line from another organization should be rejected').toBe(400)
    } finally {
      if (orderLine) {
        const { id, organization_id: organizationId } = orderLine
        await withClient((client) =>
          client.query('update sales_order_lines set organization_id = $2 where id = $1', [id, organizationId]),
        )
      }
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('replaces lines only with replaceLines, and undo restores the original line ids', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const token = await getAuthToken(request, 'admin')
    let invoiceId: string | null = null
    let orderId: string | null = null
    try {
      orderId = await createSalesOrderFixture(request, token, 'EUR')
      const orderLineId = await withClient(async (client) => {
        const result = await client.query<{ id: string }>('select id from sales_order_lines where order_id = $1', [orderId])
        return result.rows[0]?.id ?? null
      })
      expect(orderLineId, 'the order fixture should have a line').toBeTruthy()
      invoiceId = await createInvoice(request, token, {
        lines: [{ ...productLine, orderLineId }],
        subtotalNetAmount: 100,
        subtotalGrossAmount: 123,
        taxTotalAmount: 23,
        grandTotalNetAmount: 100,
        grandTotalGrossAmount: 123,
        paidTotalAmount: 10,
        outstandingAmount: 113,
      })
      const original = await readLines(invoiceId)
      expect(original.map((line) => line.order_line_id), 'create stores the order line').toEqual([orderLineId])

      const ignored = await apiRequest(request, 'PUT', INVOICES, {
        token,
        data: { id: invoiceId, lines: [discountLine] },
      })
      expect(ignored.status()).toBe(200)
      expect(await readLines(invoiceId), 'lines without replaceLines are ignored').toEqual(original)
      const ignoredFalse = await apiRequest(request, 'PUT', INVOICES, {
        token,
        data: { id: invoiceId, replaceLines: false, lines: [discountLine] },
      })
      expect(ignoredFalse.status(), 'replaceLines: false keeps being accepted').toBe(200)
      expect(await readLines(invoiceId), 'replaceLines: false leaves the lines alone').toEqual(original)

      for (const [label, data] of [
        ['replaceLines without totals', { replaceLines: true, lines: [productLine] }],
        ['replaceLines with no lines', { replaceLines: true, lines: [], ...totals }],
        [
          'replaceLines with an unknown order line',
          { replaceLines: true, lines: [{ ...productLine, orderLineId: UNKNOWN_ORDER_LINE_ID }], ...totals },
        ],
      ] as Array<[string, JsonMap]>) {
        const response = await apiRequest(request, 'PUT', INVOICES, { token, data: { id: invoiceId, ...data } })
        expect(response.status(), `${label} should be rejected`).toBe(400)
      }
      expect(await readLines(invoiceId), 'rejected replacements leave the lines alone').toEqual(original)

      const replace = await apiRequest(request, 'PUT', INVOICES, {
        token,
        data: {
          id: invoiceId,
          replaceLines: true,
          lines: [{ ...productLine, orderLineId }, discountLine],
          ...totals,
        },
      })
      expect(replace.status(), 'replaceLines update should be 200').toBe(200)
      const operation = expectOperation(replace, 'invoice line replacement')
      const replaced = await readLines(invoiceId)
      expect(replaced.map((line) => line.order_line_id), 'replacement stores the order line').toEqual([orderLineId, null])
      expect(replaced.map((line) => line.id)).not.toContain(original[0].id)
      const afterReplace = await readInvoice(request, token, invoiceId)
      expect(amount(afterReplace, 'grandTotalGrossAmount', 'grand_total_gross_amount')).toBe(110.7)
      expect(amount(afterReplace, 'outstandingAmount', 'outstanding_amount'), 'omitted totals keep their value').toBe(113)

      const undo = await undoByToken(request, token, operation.undoToken)
      expect(undo.status(), 'undo of the replacement should succeed').toBe(200)
      expect(await readLines(invoiceId), 'undo restores the lines with their order line').toEqual(original)
      const restored = await readInvoice(request, token, invoiceId)
      expect(amount(restored, 'grandTotalGrossAmount', 'grand_total_gross_amount')).toBe(123)

      const redo = await redoByLogId(request, token, operation.logId)
      expect(redo.status(), 'redo of the undone replacement should succeed').toBe(200)
      const redone = await readLines(invoiceId)
      expect(redone).toHaveLength(2)
      expect(redone.map((line) => line.id)).not.toContain(original[0].id)
    } finally {
      await purgeInvoice(invoiceId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('refuses an undo with 409 after another actor edited the replaced lines', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const token = await getAuthToken(request, 'admin')
    let invoiceId: string | null = null
    try {
      invoiceId = await createInvoice(request, token, { lines: [productLine], grandTotalGrossAmount: 123 })
      const replace = await apiRequest(request, 'PUT', INVOICES, {
        token,
        data: { id: invoiceId, replaceLines: true, lines: [discountLine, productLine], ...totals },
      })
      const operation = expectOperation(replace, 'invoice line replacement')
      await withClient((client) =>
        client.query("update sales_invoice_lines set name = 'changed elsewhere' where invoice_id = $1", [invoiceId]),
      )
      const before = await readLines(invoiceId)

      const undo = await undoByToken(request, token, operation.undoToken)
      expect(undo.status()).toBe(409)
      expect(await readLines(invoiceId), 'a refused undo leaves the lines unchanged').toEqual(before)
    } finally {
      await purgeInvoice(invoiceId)
    }
  })

  test('two concurrent replaceLines updates end with exactly one line set', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let invoiceId: string | null = null
    try {
      invoiceId = await createInvoice(request, token, { lines: [productLine], grandTotalGrossAmount: 123 })
      const setA = [1, 2].map((n) => ({ ...productLine, name: `A-${n}` }))
      const setB = [1, 2, 3].map((n) => ({ ...productLine, name: `B-${n}` }))
      const [first, second] = await withClient(async (client) => {
        await client.query('begin')
        await client.query('select id from sales_invoices where id = $1 for update', [invoiceId])
        const updates = Promise.all(
          [setA, setB].map((lines) =>
            apiRequest(request, 'PUT', INVOICES, { token, data: { id: invoiceId, replaceLines: true, lines, ...totals } }),
          ),
        )
        await waitForLockWaiters(client, 2)
        await client.query('commit')
        return updates
      })
      expect([first.status(), second.status()]).toEqual([200, 200])
      const names = await withClient(async (client) => {
        const result = await client.query<{ name: string }>(
          'select name from sales_invoice_lines where invoice_id = $1 order by name',
          [invoiceId],
        )
        return result.rows.map((row) => row.name)
      })
      expect([['A-1', 'A-2'], ['B-1', 'B-2', 'B-3']], 'the row lock serializes the two replacements').toContainEqual(names)

      const finalLineIds = (await readLines(invoiceId)).map((line) => line.id).sort()
      const [snapshotsA, snapshotsB] = await Promise.all(
        [first, second].map((response) =>
          readUpdateSnapshots(request, token, invoiceId as string, expectOperation(response, 'concurrent replaceLines').logId),
        ),
      )
      const [earlier, later] = sameStrings(snapshotsB.after, finalLineIds) ? [snapshotsA, snapshotsB] : [snapshotsB, snapshotsA]
      expect(later.after, 'the later update logged the stored lines as its after').toEqual(finalLineIds)
      expect(later.before, 'the later update read its before under the lock, after the earlier commit').toEqual(earlier.after)
    } finally {
      await purgeInvoice(invoiceId)
    }
  })

  test('two concurrent replaceLines updates sent with the same expected version: one succeeds, the other answers 409', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let invoiceId: string | null = null
    try {
      invoiceId = await createInvoice(request, token, { lines: [productLine], grandTotalGrossAmount: 123 })
      const invoice = await readInvoice(request, token, invoiceId)
      const expectedVersion = String(invoice?.updatedAt ?? invoice?.updated_at ?? '')
      expect(expectedVersion, 'the invoice list should return updatedAt').not.toBe('')
      const setA = [1, 2].map((n) => ({ ...productLine, name: `A-${n}` }))
      const setB = [1, 2, 3].map((n) => ({ ...productLine, name: `B-${n}` }))
      const [first, second] = await withClient(async (client) => {
        await client.query('begin')
        await client.query('select id from sales_invoices where id = $1 for update', [invoiceId])
        const updates = Promise.all(
          [setA, setB].map((lines) =>
            apiRequest(request, 'PUT', INVOICES, {
              token,
              headers: { 'x-om-ext-optimistic-lock-expected-updated-at': expectedVersion },
              data: { id: invoiceId, replaceLines: true, lines, ...totals },
            }),
          ),
        )
        await waitForLockWaiters(client, 2)
        await client.query('commit')
        return updates
      })
      const statuses = [first.status(), second.status()]
      expect([...statuses].sort(), 'exactly one update wins').toEqual([200, 409])
      const loser = statuses[0] === 409 ? first : second
      const conflict = await readJsonSafe<{ code?: string }>(loser)
      expect(conflict?.code).toBe('optimistic_lock_conflict')
      const winnerNames = (statuses[0] === 200 ? setA : setB).map((line) => line.name).sort()
      const names = await withClient(async (client) => {
        const result = await client.query<{ name: string }>(
          'select name from sales_invoice_lines where invoice_id = $1 order by name',
          [invoiceId],
        )
        return result.rows.map((row) => row.name)
      })
      expect(names, 'only the winning update replaced the lines').toEqual(winnerNames)
    } finally {
      await purgeInvoice(invoiceId)
    }
  })

  test('replaces lines on an invoice with a payment allocation and leaves the allocation linked', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let invoiceId: string | null = null
    let paymentId: string | null = null
    try {
      invoiceId = await createInvoice(request, token, { lines: [productLine], grandTotalGrossAmount: 123 })
      paymentId = await withClient(async (client) => {
        const scope = await client.query<{ organization_id: string; tenant_id: string }>(
          'select organization_id, tenant_id from sales_invoices where id = $1',
          [invoiceId],
        )
        const { organization_id: organizationId, tenant_id: tenantId } = scope.rows[0]
        const payment = await client.query<{ id: string }>(
          `insert into sales_payments (id, organization_id, tenant_id, currency_code, created_at, updated_at)
           values (gen_random_uuid(), $1, $2, 'EUR', now(), now()) returning id`,
          [organizationId, tenantId],
        )
        await client.query(
          `insert into sales_payment_allocations (id, payment_id, invoice_id, organization_id, tenant_id, currency_code)
           values (gen_random_uuid(), $1, $2, $3, $4, 'EUR')`,
          [payment.rows[0].id, invoiceId, organizationId, tenantId],
        )
        return payment.rows[0].id
      })

      const replace = await apiRequest(request, 'PUT', INVOICES, {
        token,
        data: { id: invoiceId, replaceLines: true, lines: [productLine, discountLine], ...totals },
      })
      expect(replace.status()).toBe(200)
      expect(await readLines(invoiceId)).toHaveLength(2)
      const linked = await withClient(async (client) => {
        const result = await client.query<{ count: string }>(
          'select count(*)::text as count from sales_payment_allocations where invoice_id = $1',
          [invoiceId],
        )
        return Number(result.rows[0]?.count ?? 0)
      })
      expect(linked).toBe(1)
    } finally {
      await withClient(async (client) => {
        await client.query('delete from sales_payment_allocations where invoice_id = $1', [invoiceId])
        if (paymentId) await client.query('delete from sales_payments where id = $1', [paymentId])
      })
      await purgeInvoice(invoiceId)
    }
  })
})
