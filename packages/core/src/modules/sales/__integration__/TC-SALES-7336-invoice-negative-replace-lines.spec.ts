import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

/**
 * TC-SALES-7336 — negative invoice amounts (Phase 2 of
 * `.ai/specs/2026-11-06-sales-invoice-import-write-path.md`).
 *
 * No API response carries invoice lines, so lines are read from the database.
 */

const INVOICES = '/api/sales/invoices'

type JsonMap = Record<string, unknown>
type StoredLine = { id: string; kind: string; total_net_amount: string; total_gross_amount: string; unit_price_net: string }

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

async function readLines(invoiceId: string): Promise<StoredLine[]> {
  return withClient(async (client) => {
    const result = await client.query<StoredLine>(
      `select id, kind, total_net_amount::text, total_gross_amount::text, unit_price_net::text
         from sales_invoice_lines where invoice_id = $1 order by line_number asc, id asc`,
      [invoiceId],
    )
    return result.rows
  })
}

async function readInvoice(request: APIRequestContext, token: string, id: string): Promise<JsonMap | undefined> {
  const response = await apiRequest(request, 'GET', `${INVOICES}?id=${encodeURIComponent(id)}`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items?: JsonMap[] }>(response)
  return body?.items?.find((item) => item.id === id)
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

test.describe('TC-SALES-7336: negative invoice amounts', () => {
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
})
