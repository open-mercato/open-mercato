import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import { hashAuthToken } from '@open-mercato/core/modules/auth/lib/tokenHash'

/**
 * TC-SALES-045 — recurrence on quotes and orders (spec 2026-10-21-sales-recurring-orders, phase 1).
 *
 * Covers create/update/remove of `recurrence` on quotes and orders, its derived fields
 * in the list/detail response, carrying it through quote → order conversion, and the
 * guards that refuse converting, accepting or sending a recurring quote that already
 * started or has no lines.
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

function appBaseUrl(): string {
  const baseUrl = new URL(process.env.BASE_URL || 'http://localhost:3000')
  if (baseUrl.hostname === '127.0.0.1') baseUrl.hostname = 'localhost'
  return baseUrl.origin
}

function isoDayFromToday(offsetDays: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function addIsoDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

async function readDocument(
  request: APIRequestContext,
  token: string,
  resource: 'orders' | 'quotes',
  id: string,
): Promise<JsonRecord> {
  const response = await apiRequest(request, 'GET', `/api/sales/${resource}?id=${encodeURIComponent(id)}`, { token })
  expect(response.status(), `GET /api/sales/${resource}?id should be 200`).toBe(200)
  const items = ((await readJson(response)).items ?? []) as JsonRecord[]
  return items[0] ?? {}
}

async function createDocument(
  request: APIRequestContext,
  token: string,
  resource: 'orders' | 'quotes',
  data: JsonRecord,
): Promise<string> {
  const response = await apiRequest(request, 'POST', `/api/sales/${resource}`, { token, data })
  const body = await readJson(response)
  expect(response.status(), `POST /api/sales/${resource}: ${JSON.stringify(body).slice(0, 300)}`).toBe(201)
  return body.id as string
}

async function updateDocument(
  request: APIRequestContext,
  token: string,
  resource: 'orders' | 'quotes',
  data: JsonRecord,
): Promise<APIResponse> {
  return apiRequest(request, 'PUT', `/api/sales/${resource}`, { token, data })
}

async function addQuoteLine(request: APIRequestContext, token: string, quoteId: string): Promise<void> {
  const response = await apiRequest(request, 'POST', '/api/sales/quote-lines', {
    token,
    data: { quoteId, currencyCode: 'USD', name: 'QA TC-SALES-045 rent', quantity: 1, unitPriceNet: 100, unitPriceGross: 123, taxRate: 23 },
  })
  expect(response.status(), 'POST /api/sales/quote-lines should be 201').toBe(201)
}

async function quoteRecurrenceRowCount(quoteId: string): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query('select count(*)::int as count from sales_quote_recurrences where quote_id = $1', [
      quoteId,
    ])
    return result.rows[0].count as number
  })
}

const orderLine = { currencyCode: 'USD', name: 'QA TC-SALES-045 service', quantity: 1, unitPriceNet: 50, unitPriceGross: 61.5, taxRate: 23 }

test.describe('TC-SALES-045 recurrence on quotes and orders', () => {
  test('creates, replaces and removes a quote recurrence', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const startsOn = isoDayFromToday(30)
    let quoteId: string | null = null
    try {
      quoteId = await createDocument(request, token, 'quotes', {
        currencyCode: 'USD',
        recurrence: { frequency: 'monthly', startsOn, periodCount: 12 },
      })
      const created = await readDocument(request, token, 'quotes', quoteId)
      expect(created.recurrence).toMatchObject({
        frequency: 'monthly',
        startsOn,
        anchorDay: null,
        periodCount: 12,
        status: null,
        locked: false,
      })
      expect(typeof (created.recurrence as JsonRecord).endsOn).toBe('string')

      const replaced = await updateDocument(request, token, 'quotes', {
        id: quoteId,
        recurrence: { frequency: 'weekly', startsOn, periodCount: 2 },
      })
      expect(replaced.status(), 'a recurrence-only update is a valid update').toBe(200)
      const afterReplace = await readDocument(request, token, 'quotes', quoteId)
      expect(afterReplace.recurrence).toMatchObject({
        frequency: 'weekly',
        periodCount: 2,
        endsOn: addIsoDays(startsOn, 13),
      })

      const removed = await updateDocument(request, token, 'quotes', { id: quoteId, recurrence: null })
      expect(removed.status()).toBe(200)
      expect((await readDocument(request, token, 'quotes', quoteId)).recurrence).toBeNull()
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    }
  })

  test('creates an order recurrence with derived fields and bumps the schedule version on change', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const startsOn = isoDayFromToday(14)
    let orderId: string | null = null
    let plainOrderId: string | null = null
    try {
      orderId = await createDocument(request, token, 'orders', {
        currencyCode: 'USD',
        lines: [orderLine],
        recurrence: { frequency: 'monthly', startsOn },
      })
      const created = await readDocument(request, token, 'orders', orderId)
      expect(created.recurrence).toMatchObject({
        frequency: 'monthly',
        startsOn,
        periodCount: null,
        endsOn: null,
        nextInvoiceOn: startsOn,
        status: 'scheduled',
        scheduleVersion: 1,
        locked: false,
      })

      const changed = await updateDocument(request, token, 'orders', {
        id: orderId,
        recurrence: { frequency: 'quarterly', startsOn, periodCount: 4 },
      })
      expect(changed.status()).toBe(200)
      const afterChange = await readDocument(request, token, 'orders', orderId)
      expect(afterChange.recurrence).toMatchObject({ frequency: 'quarterly', periodCount: 4, scheduleVersion: 2 })

      plainOrderId = await createDocument(request, token, 'orders', { currencyCode: 'USD', lines: [orderLine] })
      expect((await readDocument(request, token, 'orders', plainOrderId)).recurrence).toBeNull()
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', plainOrderId)
    }
  })

  test('rejects an invalid recurrence', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'POST', '/api/sales/quotes', {
      token,
      data: { currencyCode: 'USD', recurrence: { frequency: 'monthly', startsOn: '2027-04-15', anchorDay: 31 } },
    })
    expect(response.status()).toBe(400)
  })

  test('converts a recurring quote into a recurring order with the same schedule', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const startsOn = isoDayFromToday(7)
    let quoteId: string | null = null
    let orderId: string | null = null
    try {
      quoteId = await createDocument(request, token, 'quotes', {
        currencyCode: 'USD',
        recurrence: { frequency: 'monthly', startsOn, periodCount: 24 },
      })
      await addQuoteLine(request, token, quoteId)

      const convert = await apiRequest(request, 'POST', '/api/sales/quotes/convert', { token, data: { quoteId } })
      expect(convert.status(), 'POST /api/sales/quotes/convert should be 200').toBe(200)
      orderId = (await readJson(convert)).orderId as string

      const order = await readDocument(request, token, 'orders', orderId)
      expect(order.recurrence).toMatchObject({
        frequency: 'monthly',
        startsOn,
        periodCount: 24,
        nextInvoiceOn: startsOn,
        status: 'scheduled',
        scheduleVersion: 1,
      })
      expect(await quoteRecurrenceRowCount(quoteId), 'the quote recurrence goes with the converted quote').toBe(0)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    }
  })

  test('refuses to convert a recurring quote whose start date has passed', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let quoteId: string | null = null
    let orderId: string | null = null
    try {
      quoteId = await createDocument(request, token, 'quotes', {
        currencyCode: 'USD',
        recurrence: { frequency: 'monthly', startsOn: isoDayFromToday(-10) },
      })
      await addQuoteLine(request, token, quoteId)

      const convert = await apiRequest(request, 'POST', '/api/sales/quotes/convert', { token, data: { quoteId } })
      const body = await readJson(convert)
      orderId = typeof body.orderId === 'string' ? body.orderId : null
      expect(convert.status()).toBe(422)
      expect(body.code).toBe('recurring_quote_started')
      expect((await readDocument(request, token, 'quotes', quoteId)).recurrence).not.toBeNull()
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    }
  })

  test('refuses public acceptance of a recurring quote whose start date has passed', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const publicToken = randomUUID()
    let quoteId: string | null = null
    let orderId: string | null = null
    try {
      quoteId = await createDocument(request, token, 'quotes', {
        currencyCode: 'USD',
        recurrence: { frequency: 'monthly', startsOn: isoDayFromToday(-3) },
      })
      await addQuoteLine(request, token, quoteId)
      await withClient(async (client) => {
        const result = await client.query(
          `update sales_quotes set acceptance_token = $2, status = 'sent', updated_at = now() where id = $1`,
          [quoteId, hashAuthToken(publicToken)],
        )
        expect(result.rowCount).toBe(1)
      })

      const accept = await request.post(`${appBaseUrl()}/api/sales/quotes/accept`, {
        headers: { 'Content-Type': 'application/json', Origin: appBaseUrl() },
        data: { token: publicToken },
      })
      const body = await readJson(accept)
      orderId = typeof body.orderId === 'string' ? body.orderId : null
      expect(accept.status()).toBe(422)
      expect(body.code).toBe('recurring_quote_started')
      const quote = await readDocument(request, token, 'quotes', quoteId)
      expect(quote.status, 'the refused acceptance rolls back the status change').toBe('sent')
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    }
  })

  test('refuses to send or convert a recurring quote without lines', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let quoteId: string | null = null
    try {
      quoteId = await createDocument(request, token, 'quotes', {
        currencyCode: 'USD',
        metadata: { customerEmail: 'qa-tc-sales-045@example.com' },
        recurrence: { frequency: 'monthly', startsOn: isoDayFromToday(5) },
      })

      const send = await apiRequest(request, 'POST', '/api/sales/quotes/send', { token, data: { quoteId } })
      expect(send.status()).toBe(422)
      expect((await readJson(send)).code).toBe('recurring_quote_no_lines')

      const convert = await apiRequest(request, 'POST', '/api/sales/quotes/convert', { token, data: { quoteId } })
      expect(convert.status()).toBe(422)
      expect((await readJson(convert)).code).toBe('recurring_quote_no_lines')
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    }
  })
})
