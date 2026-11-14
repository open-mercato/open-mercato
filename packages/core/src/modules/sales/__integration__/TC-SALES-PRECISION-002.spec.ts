import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

/**
 * TC-SALES-PRECISION-002: shipping method base rates and invoice amounts sent as
 * 25-significant-digit decimal strings keep every digit through create, update and
 * read back. Invoice lines have no read API, so the line is read back from the
 * invoice create audit snapshot. Amounts beyond the decimal size caps are rejected
 * with a 400 instead of being stored as zero.
 * Source: .ai/specs/2026-10-08-arbitrary-precision-money-and-fx.md
 */

type JsonRecord = Record<string, unknown>

const CREATED_NET = '1234567890.123456789012345'
const CREATED_GROSS = '1518518504.851851850485185'
const UPDATED_NET = '9876543210.987654321098765'
const UPDATED_GROSS = '12148148149.51481481495148'
const INVOICE_TOTAL = '4567890123.456789012345678'
const INVOICE_LINE_PRICE = '7890123456.789012345678901'

async function readJson(response: APIResponse): Promise<JsonRecord> {
  const raw = await response.text()
  if (!raw) return {}
  try {
    return JSON.parse(raw) as JsonRecord
  } catch {
    return {}
  }
}

async function readFirstItem(request: APIRequestContext, token: string, path: string): Promise<JsonRecord> {
  const response = await apiRequest(request, 'GET', path, { token })
  expect(response.status(), `GET ${path} should be 200`).toBe(200)
  const body = await readJson(response)
  const items = Array.isArray(body.items) ? (body.items as JsonRecord[]) : []
  return items[0] ?? {}
}

async function readCreateSnapshot(
  request: APIRequestContext,
  token: string,
  resourceKind: string,
  resourceId: string,
  commandId: string,
): Promise<JsonRecord> {
  const query = `resourceKind=${encodeURIComponent(resourceKind)}&resourceId=${encodeURIComponent(resourceId)}`
  const response = await apiRequest(request, 'GET', `/api/audit_logs/audit-logs/actions?${query}`, { token })
  expect(response.status(), 'GET /api/audit_logs/audit-logs/actions should be 200').toBe(200)
  const items = ((await readJson(response)).items ?? []) as JsonRecord[]
  const entry = items.find((item) => item.commandId === commandId)
  const snapshot = entry?.snapshotAfter
  return snapshot && typeof snapshot === 'object' ? (snapshot as JsonRecord) : {}
}

test.describe('TC-SALES-PRECISION-002: exact shipping method rates and invoice amounts', () => {
  test('shipping method base rates keep every digit through create, update and read back', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let shippingMethodId: string | null = null
    const stamp = `${Date.now()}-${Math.round(Math.random() * 1_000_000)}`

    try {
      const createResponse = await apiRequest(request, 'POST', '/api/sales/shipping-methods', {
        token,
        data: {
          name: `QA precision ${stamp}`,
          code: `qa-precision-${stamp}`,
          currencyCode: 'USD',
          isActive: true,
          baseRateNet: CREATED_NET,
          baseRateGross: CREATED_GROSS,
        },
      })
      expect(createResponse.status(), 'POST /api/sales/shipping-methods should be 201').toBe(201)
      shippingMethodId = (await readJson(createResponse)).id as string
      expect(shippingMethodId, 'shipping method create should return id').toBeTruthy()

      const detailPath = `/api/sales/shipping-methods?id=${encodeURIComponent(shippingMethodId)}`
      const created = await readFirstItem(request, token, detailPath)
      expect(created.baseRateNet).toBe(CREATED_NET)
      expect(created.baseRateGross).toBe(CREATED_GROSS)

      const updateResponse = await apiRequest(request, 'PUT', '/api/sales/shipping-methods', {
        token,
        data: { id: shippingMethodId, baseRateNet: UPDATED_NET, baseRateGross: UPDATED_GROSS },
      })
      expect(updateResponse.status(), 'PUT /api/sales/shipping-methods should be 200').toBe(200)

      const updated = await readFirstItem(request, token, detailPath)
      expect(updated.baseRateNet).toBe(UPDATED_NET)
      expect(updated.baseRateGross).toBe(UPDATED_GROSS)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/shipping-methods', shippingMethodId)
    }
  })

  test('invoice totals and line amounts keep every digit', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let invoiceId: string | null = null

    try {
      const createResponse = await apiRequest(request, 'POST', '/api/sales/invoices', {
        token,
        data: {
          currencyCode: 'USD',
          grandTotalNetAmount: INVOICE_TOTAL,
          grandTotalGrossAmount: INVOICE_TOTAL,
          lines: [
            {
              currencyCode: 'USD',
              quantity: 1,
              name: 'QA precise invoice line',
              unitPriceNet: INVOICE_LINE_PRICE,
              unitPriceGross: INVOICE_LINE_PRICE,
            },
          ],
        },
      })
      expect(createResponse.status(), 'POST /api/sales/invoices should be 201').toBe(201)
      invoiceId = (await readJson(createResponse)).invoiceId as string
      expect(invoiceId, 'invoice create should return invoiceId').toBeTruthy()

      const invoice = await readFirstItem(request, token, `/api/sales/invoices?id=${encodeURIComponent(invoiceId)}`)
      expect(String(invoice.grand_total_net_amount)).toBe(INVOICE_TOTAL)
      expect(String(invoice.grand_total_gross_amount)).toBe(INVOICE_TOTAL)

      const createdInvoiceId = invoiceId
      await expect
        .poll(async () => {
          const snapshot = await readCreateSnapshot(request, token, 'sales.invoice', createdInvoiceId, 'sales.invoices.create')
          const lines = Array.isArray(snapshot.lines) ? (snapshot.lines as JsonRecord[]) : []
          return lines[0]?.unitPriceNet
        }, { message: 'invoice line unit price should keep all 25 significant digits' })
        .toBe(INVOICE_LINE_PRICE)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/invoices', invoiceId)
    }
  })

  test('amounts beyond the decimal size caps are rejected instead of stored as zero', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let invoiceId: string | null = null
    let shippingMethodId: string | null = null
    const stamp = `${Date.now()}-${Math.round(Math.random() * 1_000_000)}`

    try {
      const invoiceResponse = await apiRequest(request, 'POST', '/api/sales/invoices', {
        token,
        data: {
          currencyCode: 'USD',
          lines: [{ currencyCode: 'USD', quantity: 1, name: 'QA oversized line', unitPriceNet: 1e305 }],
        },
      })
      if (invoiceResponse.status() === 201) invoiceId = (await readJson(invoiceResponse)).invoiceId as string
      expect(invoiceResponse.status(), 'an invoice line unit price of 1e305 should be rejected').toBe(400)

      const shippingResponse = await apiRequest(request, 'POST', '/api/sales/shipping-methods', {
        token,
        data: {
          name: `QA oversized ${stamp}`,
          code: `qa-oversized-${stamp}`,
          currencyCode: 'USD',
          baseRateNet: `0.${'1'.repeat(1001)}`,
        },
      })
      if (shippingResponse.status() === 201) shippingMethodId = (await readJson(shippingResponse)).id as string
      expect(shippingResponse.status(), 'a 1001 significant digit base rate should be rejected').toBe(400)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/invoices', invoiceId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/shipping-methods', shippingMethodId)
    }
  })
})
