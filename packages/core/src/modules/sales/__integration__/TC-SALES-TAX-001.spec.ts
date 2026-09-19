import { expect, test, type APIRequestContext } from '@playwright/test'
import {
  createSalesOrderFixture,
  createOrderLineFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * TC-SALES-TAX-001 — Acceptance 1 of .ai/specs/2026-09-19-pluggable-tax-providers.md.
 *
 * With no provider configured, the built in `table-rates` provider runs. It is
 * an identity over the calculation engine's own per line math, so the single
 * most important property of the whole spec is that **no amount moves**: an
 * organization that never opens the settings page keeps every figure it had
 * before this contract existed.
 *
 * This spec proves that end to end rather than in a unit test, and additionally
 * proves that the provenance the phase adds is actually persisted and exposed:
 * the provider key, a `calculated` status, a calculation timestamp, and one
 * breakdown row per distinct rate. It then raises an invoice from the order and
 * asserts the five columns were inherited with an `inherited` message, which is
 * the only path by which an invoice acquires tax provenance.
 *
 * Self contained: every record it reads it created, and the finally block
 * removes them.
 */

type JsonMap = Record<string, unknown>

async function readJson(request: APIRequestContext, token: string, path: string): Promise<JsonMap> {
  const response = await apiRequest(request, 'GET', path, { token, retryTransport: false })
  const text = await response.text()
  expect(response.ok(), `GET ${path} failed: ${response.status()} ${text.slice(0, 400)}`).toBeTruthy()
  return JSON.parse(text) as JsonMap
}

async function readOrder(request: APIRequestContext, token: string, orderId: string): Promise<JsonMap> {
  const body = await readJson(request, token, `/api/sales/orders?id=${orderId}`)
  const items = Array.isArray(body.items) ? (body.items as JsonMap[]) : []
  expect(items.length, `order ${orderId} not returned by the list route`).toBeGreaterThan(0)
  return items[0]
}

function numeric(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '') return Number(value)
  return Number.NaN
}

test.describe('TC-SALES-TAX-001: default tax provider keeps every amount and records provenance', () => {
  test('table-rates reproduces the engine figures and the invoice inherits them', async ({ request }) => {
    test.slow()

    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null
    let invoiceId: string | null = null

    try {
      orderId = await createSalesOrderFixture(request, token)

      // Two lines carrying different table rates, so the document level
      // breakdown must hold two distinct jurisdiction rows.
      await createOrderLineFixture(request, token, orderId, {
        name: `TC-SALES-TAX-001 line A ${Date.now()}`,
        quantity: 2,
        unitPriceNet: 100,
        unitPriceGross: 120,
        taxRate: 20,
      })
      await createOrderLineFixture(request, token, orderId, {
        name: `TC-SALES-TAX-001 line B ${Date.now()}`,
        quantity: 1,
        unitPriceNet: 50,
        unitPriceGross: 53.5,
        taxRate: 7,
      })

      const order = await readOrder(request, token, orderId)

      // 1. The amounts are the engine's own. 2 x 100 at 20% plus 1 x 50 at 7%
      //    is 40 + 3.5 of tax on 250 net; the seed line is zero priced.
      expect(numeric(order.subtotalNetAmount)).toBeCloseTo(250, 4)
      expect(numeric(order.taxTotalAmount)).toBeCloseTo(43.5, 4)
      expect(numeric(order.grandTotalGrossAmount)).toBeCloseTo(293.5, 4)

      // 2. Provenance is recorded and exposed.
      expect(order.taxStrategyKey).toBe('table-rates')
      expect(order.taxStatus).toBe('calculated')
      expect(order.taxCalculatedAt).toBeTruthy()
      // The built in provider records no vendor transaction.
      expect(order.taxTransactionRef ?? null).toBeNull()

      const taxInfo = order.taxInfo as JsonMap | null
      expect(taxInfo, 'taxInfo must be returned on a single-document fetch').toBeTruthy()
      expect(taxInfo!.version).toBe(1)
      expect(taxInfo!.providerKey).toBe('table-rates')
      expect(taxInfo!.status).toBe('calculated')
      expect(taxInfo!.failure ?? null).toBeNull()

      // 3. The document total equals the sum of the breakdown rows, and there is
      //    one row per distinct rate.
      const breakdown = (taxInfo!.breakdown ?? []) as JsonMap[]
      expect(breakdown.length).toBe(2)
      const breakdownSum = breakdown.reduce((sum, row) => sum + numeric(row.taxAmount), 0)
      expect(breakdownSum).toBeCloseTo(numeric(order.taxTotalAmount), 4)
      expect(breakdown.map((row) => numeric(row.rate)).sort((a, b) => a - b)).toEqual([7, 20])

      // 4. The per line figures also sum to the header total, which is what the
      //    reconciliation rule guarantees.
      const infoLines = (taxInfo!.lines ?? []) as JsonMap[]
      const lineSum = infoLines.reduce((sum, row) => sum + numeric(row.taxAmount), 0)
      expect(lineSum).toBeCloseTo(numeric(order.taxTotalAmount), 4)

      // 5. An invoice raised from the order inherits all five columns plus a
      //    message naming the source.
      const invoiceResponse = await apiRequest(request, 'POST', '/api/sales/invoices', {
        token,
        retryTransport: false,
        data: {
          orderId,
          currencyCode: 'USD',
          subtotalNetAmount: numeric(order.subtotalNetAmount),
          subtotalGrossAmount: numeric(order.subtotalGrossAmount),
          taxTotalAmount: numeric(order.taxTotalAmount),
          grandTotalNetAmount: numeric(order.grandTotalNetAmount),
          grandTotalGrossAmount: numeric(order.grandTotalGrossAmount),
        },
      })
      const invoiceText = await invoiceResponse.text()
      expect(
        invoiceResponse.ok(),
        `POST /api/sales/invoices failed: ${invoiceResponse.status()} ${invoiceText.slice(0, 400)}`,
      ).toBeTruthy()
      const invoiceBody = JSON.parse(invoiceText) as JsonMap
      invoiceId = (invoiceBody.invoiceId ?? invoiceBody.id) as string

      const invoiceList = await readJson(request, token, `/api/sales/invoices?id=${invoiceId}`)
      const invoices = Array.isArray(invoiceList.items) ? (invoiceList.items as JsonMap[]) : []
      expect(invoices.length).toBeGreaterThan(0)
      const invoice = invoices[0]

      expect(invoice.taxStrategyKey).toBe('table-rates')
      expect(invoice.taxStatus).toBe('calculated')
      expect(invoice.taxCalculatedAt).toBeTruthy()

      const invoiceTaxInfo = invoice.taxInfo as JsonMap | null
      expect(invoiceTaxInfo, 'the invoice must inherit the order tax document').toBeTruthy()
      const messages = (invoiceTaxInfo!.messages ?? []) as JsonMap[]
      expect(messages.some((message) => message.code === 'inherited')).toBeTruthy()
      expect(numeric((invoiceTaxInfo!.totals as JsonMap).taxTotal)).toBeCloseTo(
        numeric((taxInfo!.totals as JsonMap).taxTotal),
        4,
      )
    } finally {
      if (invoiceId) await deleteSalesEntityIfExists(request, token, '/api/sales/invoices', invoiceId)
      if (orderId) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
