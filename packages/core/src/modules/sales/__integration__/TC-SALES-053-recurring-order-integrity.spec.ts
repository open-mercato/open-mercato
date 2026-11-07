import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import {
  expectOperation,
  redoOk,
  skipIfUndoTestsDisabled,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-SALES-053 — recurring order state integrity (spec 2026-10-21-sales-recurring-orders, R7/R10).
 *
 * A canceled or on-hold order never carries an unfinished recurrence, whichever write sets the
 * status or the recurrence and whatever another writer commits in between. Quote send re-checks
 * eligibility under the quote lock, and quote conversion refuses to turn a canceled recurring
 * quote into a canceled order with a live schedule. Removing a recurrence, or deleting its order,
 * keeps its row, so the schedule version never repeats across remove, delete, undo and redo.
 *
 * The two-writer cases hold the document row lock in a test transaction, wait until the request
 * is blocked on it, commit the competing change, and only then let the request continue.
 */

type JsonRecord = Record<string, unknown>
type DbClient = Parameters<Parameters<typeof withClient>[0]>[0]

async function readJson(response: APIResponse): Promise<JsonRecord> {
  const raw = await response.text()
  if (!raw) return {}
  try {
    return JSON.parse(raw) as JsonRecord
  } catch {
    return {}
  }
}

function isoDayFromToday(offsetDays: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

const line = { currencyCode: 'USD', name: 'QA TC-SALES-053 rent', quantity: 1, unitPriceNet: 100, unitPriceGross: 123, taxRate: 23 }

async function createOrder(request: APIRequestContext, token: string, data: JsonRecord = {}): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/sales/orders', {
    token,
    data: { currencyCode: 'USD', lines: [line], ...data },
  })
  const body = await readJson(response)
  expect(response.status(), `POST /api/sales/orders: ${JSON.stringify(body).slice(0, 300)}`).toBe(201)
  return body.id as string
}

async function readOrder(request: APIRequestContext, token: string, id: string): Promise<JsonRecord> {
  const response = await apiRequest(request, 'GET', `/api/sales/orders?id=${encodeURIComponent(id)}`, { token })
  expect(response.status()).toBe(200)
  return (((await readJson(response)).items ?? []) as JsonRecord[])[0] ?? {}
}

async function orderStatusEntryId(request: APIRequestContext, token: string, value: string): Promise<string> {
  const response = await apiRequest(request, 'GET', '/api/sales/order-statuses?pageSize=100', { token })
  const items = response.ok() ? (((await readJson(response)).items ?? []) as JsonRecord[]) : []
  const entry = items.find((item) => item.value === value)
  test.skip(typeof entry?.id !== 'string', `order status "${value}" is not seeded`)
  return entry?.id as string
}

async function createQuoteWithLine(request: APIRequestContext, token: string, data: JsonRecord = {}): Promise<string> {
  const created = await apiRequest(request, 'POST', '/api/sales/quotes', { token, data: { currencyCode: 'USD', ...data } })
  expect(created.status(), 'POST /api/sales/quotes should be 201').toBe(201)
  const quoteId = (await readJson(created)).id as string
  const addedLine = await apiRequest(request, 'POST', '/api/sales/quote-lines', { token, data: { quoteId, ...line } })
  expect(addedLine.status(), 'POST /api/sales/quote-lines should be 201').toBe(201)
  return quoteId
}

async function firstLineId(request: APIRequestContext, token: string, orderId: string): Promise<string> {
  const response = await apiRequest(request, 'GET', `/api/sales/order-lines?orderId=${orderId}&pageSize=10`, { token })
  return (((await readJson(response)).items ?? []) as JsonRecord[])[0]?.id as string
}

function expectCode(response: APIResponse, body: JsonRecord, status: number, code: string, label: string): void {
  expect(response.status(), `${label}: ${JSON.stringify(body).slice(0, 200)}`).toBe(status)
  expect(body.code, label).toBe(code)
}

async function insertOrderRecurrence(client: DbClient, orderId: string): Promise<void> {
  const result = await client.query(
    `insert into sales_order_recurrences
       (organization_id, tenant_id, order_id, frequency, starts_on, next_invoice_on, created_at, updated_at)
     select organization_id, tenant_id, id, 'monthly', current_date + 5, current_date + 5, now(), now()
       from sales_orders where id = $1`,
    [orderId],
  )
  expect(result.rowCount, 'the competing recurrence should be inserted').toBe(1)
}

async function waitUntilBlockedBy(client: DbClient, settled: () => boolean): Promise<void> {
  const holder = (await client.query('select pg_backend_pid() as pid')).rows[0].pid
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline && !settled()) {
    const waiting = await client.query(
      `select count(*)::int as count from pg_stat_activity where $1 = any(pg_blocking_pids(pid))`,
      [holder],
    )
    if (Number(waiting.rows[0].count) > 0) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('the request never waited for the row lock held by the test')
}

/**
 * Sends `send` while the test holds `table`'s row lock, commits `competingWrite` once the request
 * waits for that lock, and returns the request's response.
 */
async function sendWhileAnotherWriterCommits(
  table: 'sales_orders' | 'sales_quotes',
  id: string,
  send: () => Promise<APIResponse>,
  competingWrite: (client: DbClient) => Promise<void>,
): Promise<APIResponse> {
  return withClient(async (client) => {
    await client.query('begin')
    let pending: Promise<APIResponse> | null = null
    try {
      await client.query(`select id from ${table} where id = $1 for update`, [id])
      let settled = false
      pending = send().finally(() => {
        settled = true
      })
      await waitUntilBlockedBy(client, () => settled)
      await competingWrite(client)
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      if (pending) await pending.catch(() => undefined)
      throw error
    }
    return pending
  })
}

test.describe('TC-SALES-053 recurring order state integrity', () => {
  test('refuses a stopped order carrying a new recurrence on create and update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const onHold = await orderStatusEntryId(request, token, 'on_hold')
    const canceled = await orderStatusEntryId(request, token, 'canceled')
    const recurrence = { frequency: 'monthly', startsOn: isoDayFromToday(10) }
    let orderId: string | null = null
    try {
      const created = await apiRequest(request, 'POST', '/api/sales/orders', {
        token,
        data: { currencyCode: 'USD', lines: [line], statusEntryId: onHold, recurrence },
      })
      expectCode(created, await readJson(created), 409, 'recurring_order_use_cancel', 'create on hold with a recurrence')

      orderId = await createOrder(request, token)
      const both = await apiRequest(request, 'PUT', '/api/sales/orders', {
        token,
        data: { id: orderId, statusEntryId: canceled, recurrence },
      })
      expectCode(both, await readJson(both), 409, 'recurring_order_use_cancel', 'cancel and add a recurrence')
      expect((await readOrder(request, token, orderId)).recurrence).toBeNull()

      const hold = await apiRequest(request, 'PUT', '/api/sales/orders', { token, data: { id: orderId, statusEntryId: onHold } })
      expect(hold.status(), 'an order without a recurrence can be put on hold').toBe(200)
      const added = await apiRequest(request, 'PUT', '/api/sales/orders', { token, data: { id: orderId, recurrence } })
      expectCode(added, await readJson(added), 409, 'recurring_order_use_cancel', 'add a recurrence to an on-hold order')
      expect((await readOrder(request, token, orderId)).recurrence).toBeNull()
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('re-checks a payment status change after a concurrent recurrence write', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const onHold = await orderStatusEntryId(request, token, 'on_hold')
    let orderId: string | null = null
    try {
      orderId = await createOrder(request, token)
      const payment = await apiRequest(request, 'POST', '/api/sales/payments', {
        token,
        data: { orderId, amount: '10.00', currencyCode: 'USD', receivedAt: new Date().toISOString() },
      })
      expect(payment.status(), 'payment create should be 201').toBe(201)
      const paymentId = (await readJson(payment)).id as string
      const lockedOrderId = orderId

      const response = await sendWhileAnotherWriterCommits(
        'sales_orders',
        lockedOrderId,
        () => apiRequest(request, 'PUT', '/api/sales/payments', { token, data: { id: paymentId, documentStatusEntryId: onHold } }),
        (client) => insertOrderRecurrence(client, lockedOrderId),
      )
      expectCode(response, await readJson(response), 409, 'recurring_order_use_cancel', 'payment status change')
      expect((await readOrder(request, token, orderId)).status).not.toBe('on_hold')
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('re-checks a shipment status change after a concurrent recurrence write', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const onHold = await orderStatusEntryId(request, token, 'on_hold')
    let orderId: string | null = null
    try {
      orderId = await createOrder(request, token)
      const orderLineId = await firstLineId(request, token, orderId)
      const lockedOrderId = orderId

      const response = await sendWhileAnotherWriterCommits(
        'sales_orders',
        lockedOrderId,
        () =>
          apiRequest(request, 'POST', '/api/sales/shipments', {
            token,
            data: { orderId: lockedOrderId, items: [{ orderLineId, quantity: 1 }], documentStatusEntryId: onHold },
          }),
        (client) => insertOrderRecurrence(client, lockedOrderId),
      )
      expectCode(response, await readJson(response), 409, 'recurring_order_use_cancel', 'shipment status change')
      expect((await readOrder(request, token, orderId)).status).not.toBe('on_hold')
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('re-checks quote send eligibility after a concurrent line deletion', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let quoteId: string | null = null
    try {
      const created = await apiRequest(request, 'POST', '/api/sales/quotes', {
        token,
        data: {
          currencyCode: 'USD',
          metadata: { customerEmail: 'qa-tc-sales-049@example.com' },
          recurrence: { frequency: 'monthly', startsOn: isoDayFromToday(5) },
        },
      })
      expect(created.status(), 'POST /api/sales/quotes should be 201').toBe(201)
      quoteId = (await readJson(created)).id as string
      const addedLine = await apiRequest(request, 'POST', '/api/sales/quote-lines', { token, data: { quoteId, ...line } })
      expect(addedLine.status(), 'POST /api/sales/quote-lines should be 201').toBe(201)
      const lockedQuoteId = quoteId

      const response = await sendWhileAnotherWriterCommits(
        'sales_quotes',
        lockedQuoteId,
        () => apiRequest(request, 'POST', '/api/sales/quotes/send', { token, data: { quoteId: lockedQuoteId } }),
        async (client) => {
          const removed = await client.query('delete from sales_quote_lines where quote_id = $1', [lockedQuoteId])
          expect(removed.rowCount, 'the competing writer removes the only line').toBe(1)
        },
      )
      expectCode(response, await readJson(response), 422, 'recurring_quote_no_lines', 'quote send')
      const sent = await withClient((client) => client.query('select sent_at from sales_quotes where id = $1', [lockedQuoteId]))
      expect(sent.rows[0].sent_at, 'the refused quote is not marked sent').toBeNull()
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    }
  })

  test('refuses converting a canceled recurring quote and keeps the quote', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const canceled = await orderStatusEntryId(request, token, 'canceled')
    const quoteIds: string[] = []
    const orderIds: string[] = []
    try {
      const recurringQuoteId = await createQuoteWithLine(request, token, {
        recurrence: { frequency: 'monthly', startsOn: isoDayFromToday(10) },
      })
      quoteIds.push(recurringQuoteId)
      const plainQuoteId = await createQuoteWithLine(request, token)
      quoteIds.push(plainQuoteId)
      for (const quoteId of quoteIds) {
        const update = await apiRequest(request, 'PUT', '/api/sales/quotes', { token, data: { id: quoteId, statusEntryId: canceled } })
        expect(update.status(), 'cancel the quote').toBe(200)
      }

      const refused = await apiRequest(request, 'POST', '/api/sales/quotes/convert', { token, data: { quoteId: recurringQuoteId } })
      expectCode(refused, await readJson(refused), 409, 'recurring_order_use_cancel', 'convert a canceled recurring quote')
      const left = await withClient(async (client) => ({
        quotes: (await client.query('select count(*)::int as count from sales_quotes where id = $1 and deleted_at is null', [recurringQuoteId])).rows[0].count,
        orders: (await client.query('select count(*)::int as count from sales_orders where id = $1', [recurringQuoteId])).rows[0].count,
        recurrences: (await client.query('select count(*)::int as count from sales_quote_recurrences where quote_id = $1', [recurringQuoteId])).rows[0].count,
      }))
      expect(left, 'the refused conversion leaves the quote and its schedule untouched').toEqual({ quotes: 1, orders: 0, recurrences: 1 })

      const converted = await apiRequest(request, 'POST', '/api/sales/quotes/convert', { token, data: { quoteId: plainQuoteId } })
      const convertedBody = await readJson(converted)
      expect(converted.status(), `a canceled quote without a schedule still converts: ${JSON.stringify(convertedBody).slice(0, 200)}`).toBeLessThan(300)
      orderIds.push(convertedBody.orderId as string)
      quoteIds.pop()
    } finally {
      for (const orderId of orderIds) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      for (const quoteId of quoteIds) await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    }
  })

  test('never repeats a schedule version across order delete, undo and redo', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null
    try {
      orderId = await createOrder(request, token, { recurrence: { frequency: 'monthly', startsOn: isoDayFromToday(10) } })
      const updated = await apiRequest(request, 'PUT', '/api/sales/orders', {
        token,
        data: { id: orderId, recurrence: { frequency: 'monthly', startsOn: isoDayFromToday(10), periodCount: 6 } },
      })
      expect(updated.status()).toBe(200)
      const versions = [((await readOrder(request, token, orderId)).recurrence as JsonRecord).scheduleVersion as number]
      const expectNewVersion = async (label: string) => {
        const recurrence = (await readOrder(request, token, orderId as string)).recurrence as JsonRecord | null
        expect(recurrence, label).not.toBeNull()
        const version = recurrence?.scheduleVersion as number
        expect(version, `${label}: ${version} after ${versions.join(', ')}`).toBeGreaterThan(Math.max(...versions))
        versions.push(version)
      }

      const deletion = await apiRequest(request, 'DELETE', `/api/sales/orders?id=${encodeURIComponent(orderId)}`, { token })
      expect(deletion.status()).toBe(200)
      const deletedLogId = await undoOk(request, token, expectOperation(deletion, 'delete order').undoToken, 'delete order')
      await expectNewVersion('undo of the order delete')

      const redo = await redoOk(request, token, deletedLogId, 'redo of the order delete')
      await undoOk(request, token, redo.undoToken as string, 'undo of the redone order delete')
      await expectNewVersion('second undo of the order delete')

      const rows = await withClient((client) =>
        client.query('select count(*)::int as count from sales_order_recurrences where order_id = $1', [orderId]),
      )
      expect(rows.rows[0].count, 'the order keeps one recurrence row').toBe(1)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('never repeats a schedule version across quote conversion, undo and redo', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const token = await getAuthToken(request, 'admin')
    let quoteId: string | null = null
    let orderId: string | null = null
    try {
      quoteId = await createQuoteWithLine(request, token, {
        recurrence: { frequency: 'monthly', startsOn: isoDayFromToday(10) },
      })
      const conversion = await apiRequest(request, 'POST', '/api/sales/quotes/convert', { token, data: { quoteId } })
      const conversionBody = await readJson(conversion)
      expect(conversion.status(), `convert the recurring quote: ${JSON.stringify(conversionBody).slice(0, 200)}`).toBeLessThan(300)
      orderId = conversionBody.orderId as string
      const convertedOrderId = orderId
      const versions: number[] = []
      const expectNewVersion = async (label: string) => {
        const recurrence = (await readOrder(request, token, convertedOrderId)).recurrence as JsonRecord | null
        expect(recurrence, label).not.toBeNull()
        const version = recurrence?.scheduleVersion as number
        expect(version, `${label}: ${version} after ${versions.join(', ')}`).toBeGreaterThan(Math.max(0, ...versions))
        versions.push(version)
      }
      const countRows = () =>
        withClient(async (client) => {
          const result = await client.query(
            'select count(*) filter (where deleted_at is null)::int as live, count(*)::int as total from sales_order_recurrences where order_id = $1',
            [convertedOrderId],
          )
          return { live: result.rows[0].live, total: result.rows[0].total }
        })
      await expectNewVersion('the converted order')

      const convertedLogId = await undoOk(request, token, expectOperation(conversion, 'convert quote').undoToken, 'convert quote')
      expect(await countRows(), 'undoing the conversion retires the recurrence row').toEqual({ live: 0, total: 1 })

      const redo = await redoOk(request, token, convertedLogId, 'redo of the conversion')
      await expectNewVersion('redo of the conversion')
      expect(await countRows(), 'the redone conversion revives the same row').toEqual({ live: 1, total: 1 })

      const redoneLogId = await undoOk(request, token, redo.undoToken as string, 'undo of the redone conversion')
      expect(await countRows(), 'undoing the redone conversion retires the row again').toEqual({ live: 0, total: 1 })
      await redoOk(request, token, redoneLogId, 'second redo of the conversion')
      await expectNewVersion('second redo of the conversion')
      expect(await countRows(), 'the order keeps one recurrence row').toEqual({ live: 1, total: 1 })
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    }
  })

  test('never repeats a schedule version across remove, undo and redo', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const token = await getAuthToken(request, 'admin')
    const startsOn = isoDayFromToday(10)
    let orderId: string | null = null
    try {
      orderId = await createOrder(request, token, { recurrence: { frequency: 'monthly', startsOn } })
      const versions = [((await readOrder(request, token, orderId)).recurrence as JsonRecord).scheduleVersion as number]
      const expectNewVersion = async (label: string) => {
        const recurrence = (await readOrder(request, token, orderId as string)).recurrence as JsonRecord | null
        expect(recurrence, label).not.toBeNull()
        const version = recurrence?.scheduleVersion as number
        expect(version, `${label}: ${version} after ${versions.join(', ')}`).toBeGreaterThan(Math.max(...versions))
        versions.push(version)
      }

      const removal = await apiRequest(request, 'PUT', '/api/sales/orders', { token, data: { id: orderId, recurrence: null } })
      expect(removal.status()).toBe(200)
      expect((await readOrder(request, token, orderId)).recurrence).toBeNull()
      const removedLogId = await undoOk(request, token, expectOperation(removal, 'remove recurrence').undoToken, 'remove recurrence')
      await expectNewVersion('undo of the removal')

      const redo = await redoOk(request, token, removedLogId, 'redo of the removal')
      expect((await readOrder(request, token, orderId)).recurrence).toBeNull()
      await undoOk(request, token, redo.undoToken as string, 'undo of the redone removal')
      await expectNewVersion('second undo of the removal')

      const removedAgain = await apiRequest(request, 'PUT', '/api/sales/orders', { token, data: { id: orderId, recurrence: null } })
      expect(removedAgain.status()).toBe(200)
      const readded = await apiRequest(request, 'PUT', '/api/sales/orders', {
        token,
        data: { id: orderId, recurrence: { frequency: 'monthly', startsOn } },
      })
      expect(readded.status()).toBe(200)
      await expectNewVersion('the same schedule added back')

      const rows = await withClient((client) =>
        client.query('select count(*)::int as count from sales_order_recurrences where order_id = $1', [orderId]),
      )
      expect(rows.rows[0].count, 'the order keeps one recurrence row').toBe(1)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
