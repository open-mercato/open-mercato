import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

/**
 * TC-SALES-046 — recurring order locks and status guards (spec 2026-10-21-sales-recurring-orders, R5/R10).
 *
 * Once a recurring order has an issued period, nothing that changes what is billed can be
 * edited and the order cannot be deleted. Only *Cancel recurring order* may stop an
 * unfinished recurring order, so canceled / on-hold statuses are refused. Periods are
 * inserted directly into the ledger: the invoicing worker ships in phase 2.
 */

type JsonRecord = Record<string, unknown>

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

async function readOrder(request: APIRequestContext, token: string, id: string): Promise<JsonRecord> {
  const response = await apiRequest(request, 'GET', `/api/sales/orders?id=${encodeURIComponent(id)}`, { token })
  expect(response.status()).toBe(200)
  const items = ((await readJson(response)).items ?? []) as JsonRecord[]
  return items[0] ?? {}
}

async function createRecurringOrder(request: APIRequestContext, token: string, startsOn: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/sales/orders', {
    token,
    data: {
      currencyCode: 'USD',
      lines: [{ currencyCode: 'USD', name: 'QA TC-SALES-046 rent', quantity: 1, unitPriceNet: 100, unitPriceGross: 123, taxRate: 23 }],
      recurrence: { frequency: 'monthly', startsOn },
    },
  })
  expect(response.status(), 'POST /api/sales/orders should be 201').toBe(201)
  return (await readJson(response)).id as string
}

async function insertPeriod(orderId: string, startsOn: string): Promise<void> {
  await withClient(async (client) => {
    const result = await client.query(
      `insert into sales_recurring_periods
         (organization_id, tenant_id, order_id, period_index, period_start, period_end, created_at, updated_at)
       select organization_id, tenant_id, id, 0, $2::date, ($2::date + interval '1 month' - interval '1 day')::date, now(), now()
         from sales_orders where id = $1`,
      [orderId, startsOn],
    )
    expect(result.rowCount, 'the ledger fixture row should be inserted').toBe(1)
  })
}

async function deletePeriods(orderId: string | null): Promise<void> {
  if (!orderId) return
  await withClient((client) => client.query('delete from sales_recurring_periods where order_id = $1', [orderId]))
}

async function orderStatusEntryId(request: APIRequestContext, token: string, value: string): Promise<string | null> {
  const response = await apiRequest(request, 'GET', '/api/sales/order-statuses?pageSize=100', { token })
  if (!response.ok()) return null
  const items = ((await readJson(response)).items ?? []) as JsonRecord[]
  const entry = items.find((item) => item.value === value)
  return typeof entry?.id === 'string' ? entry.id : null
}

function expectCode(response: APIResponse, body: JsonRecord, status: number, code: string, label: string): void {
  expect(response.status(), `${label}: ${JSON.stringify(body).slice(0, 200)}`).toBe(status)
  expect(body.code, label).toBe(code)
}

test.describe('TC-SALES-046 recurring order locks and status guards', () => {
  test('locks billing-relevant edits and deletion once a period exists', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const startsOn = isoDayFromToday(3)
    let orderId: string | null = null
    try {
      orderId = await createRecurringOrder(request, token, startsOn)
      const adjustment = await apiRequest(request, 'POST', '/api/sales/order-adjustments', {
        token,
        data: { orderId, scope: 'order', kind: 'discount', amountNet: 5, amountGross: 5, currencyCode: 'USD', label: 'QA discount' },
      })
      expect(adjustment.status(), 'adjustments can be added before the first period').toBe(201)
      const adjustmentId = (await readJson(adjustment)).id as string
      const lineResponse = await apiRequest(request, 'GET', `/api/sales/order-lines?orderId=${orderId}&pageSize=10`, { token })
      const lineId = (((await readJson(lineResponse)).items ?? []) as JsonRecord[])[0]?.id as string

      await insertPeriod(orderId, startsOn)
      expect((await readOrder(request, token, orderId)).recurrence).toMatchObject({ locked: true })

      const attempts: Array<[string, () => Promise<APIResponse>]> = [
        ['add line', () => apiRequest(request, 'POST', '/api/sales/order-lines', {
          token,
          data: { orderId, currencyCode: 'USD', name: 'QA extra', quantity: 1, unitPriceNet: 1, unitPriceGross: 1 },
        })],
        ['edit line', () => apiRequest(request, 'PUT', '/api/sales/order-lines', {
          token,
          data: { id: lineId, orderId, quantity: 2, currencyCode: 'USD' },
        })],
        ['delete line', () => apiRequest(request, 'DELETE', '/api/sales/order-lines', { token, data: { id: lineId, orderId } })],
        ['add adjustment', () => apiRequest(request, 'POST', '/api/sales/order-adjustments', {
          token,
          data: { orderId, scope: 'order', kind: 'surcharge', amountNet: 1, amountGross: 1, currencyCode: 'USD' },
        })],
        ['delete adjustment', () => apiRequest(request, 'DELETE', '/api/sales/order-adjustments', {
          token,
          data: { id: adjustmentId, orderId },
        })],
        ['change currency', () => apiRequest(request, 'PUT', '/api/sales/orders', { token, data: { id: orderId, currencyCode: 'EUR' } })],
        ['change recurrence', () => apiRequest(request, 'PUT', '/api/sales/orders', {
          token,
          data: { id: orderId, recurrence: { frequency: 'yearly', startsOn } },
        })],
        ['remove recurrence', () => apiRequest(request, 'PUT', '/api/sales/orders', { token, data: { id: orderId, recurrence: null } })],
      ]
      for (const [label, attempt] of attempts) {
        const response = await attempt()
        expectCode(response, await readJson(response), 409, 'recurring_order_locked', label)
      }

      const comment = await apiRequest(request, 'PUT', '/api/sales/orders', {
        token,
        data: { id: orderId, comments: 'QA TC-SALES-046 unlocked field' },
      })
      expect(comment.status(), 'fields that do not change what is billed still save').toBe(200)

      const deletion = await apiRequest(request, 'DELETE', `/api/sales/orders?id=${encodeURIComponent(orderId)}`, { token })
      expectCode(deletion, await readJson(deletion), 409, 'recurring_order_invoiced', 'delete order')
      expect((await readOrder(request, token, orderId)).id).toBe(orderId)
    } finally {
      await deletePeriods(orderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('refuses canceled and on-hold statuses on an unfinished recurring order', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null
    try {
      orderId = await createRecurringOrder(request, token, isoDayFromToday(10))
      for (const value of ['canceled', 'on_hold']) {
        const statusEntryId = await orderStatusEntryId(request, token, value)
        test.skip(!statusEntryId, `order status "${value}" is not seeded`)
        const response = await apiRequest(request, 'PUT', '/api/sales/orders', { token, data: { id: orderId, statusEntryId } })
        expectCode(response, await readJson(response), 409, 'recurring_order_use_cancel', `status ${value}`)
      }
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('deletes an unbilled recurring order together with its recurrence', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const orderId = await createRecurringOrder(request, token, isoDayFromToday(10))
    const deletion = await apiRequest(request, 'DELETE', `/api/sales/orders?id=${encodeURIComponent(orderId)}`, { token })
    expect(deletion.status()).toBe(200)
    const remaining = await withClient(async (client) => {
      const result = await client.query('select count(*)::int as count from sales_order_recurrences where order_id = $1', [
        orderId,
      ])
      return result.rows[0].count as number
    })
    expect(remaining).toBe(0)
  })
})
