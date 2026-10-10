import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCompanyFixture } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  advanceFreightOrderToCompleted,
  createFreightOrderFixture,
  createTransportDriverFixture,
  createTransportVehicleFixture,
  deleteFreightEntityIfExists,
  isoDate,
  isoInstant,
  readNumericString,
  runFreightOrderAction,
  uniqueFreightSuffix,
} from '@open-mercato/core/helpers/integration/freightFixtures'

export const integrationMeta = {
  dependsOnModules: ['freight_operations', 'customers', 'sales', 'transport_operations'],
}

const ORDERS = '/api/freight_operations/orders'
const COMPANIES = '/api/customers/companies'
const VEHICLES = '/api/transport_operations/vehicles'
const DRIVERS = '/api/transport_operations/drivers'
const SALES_ORDERS = '/api/sales/orders'
const SALES_INVOICES = '/api/sales/invoices'
const PAYMENTS = '/api/freight_operations/payments'

async function fetchSalesInvoice(request: Parameters<typeof apiRequest>[0], token: string, id: string): Promise<Record<string, unknown> | null> {
  const response = await apiRequest(request, 'GET', `${SALES_INVOICES}?ids=${id}&pageSize=1`, { token })
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
  if (!response.ok()) return null
  return body?.items?.[0] ?? null
}

/**
 * TC-FREIGHT-005: the freight payment ledger and the sales invoice stay in
 * step — record, void, and an explicit resync all land on the same numbers.
 *
 * Core recomputes only the ORDER totals on `sales.payments.create`, so the
 * invoice's paid/outstanding are a second write the bridge performs; these
 * assertions are what pins that the second write actually happens.
 */
test.describe('TC-FREIGHT-005: freight payment recording and invoice sync', () => {
  test('record, void, and resync keep the invoice totals in step', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueFreightSuffix()
    const company = await createCompanyFixture(request, token, `Payment TC ${suffix}`)
    const snapshot = { id: company, kind: 'company' as const, displayName: `Payment TC ${suffix}` }

    let order: string | null = null
    let vehicle: string | null = null
    let driver: string | null = null
    let salesOrderId: string | null = null
    let salesInvoiceId: string | null = null
    let paymentId: string | null = null

    try {
      vehicle = await createTransportVehicleFixture(request, token)
      driver = await createTransportDriverFixture(request, token)
      const created = await createFreightOrderFixture(request, token, {
        customerId: company,
        customerSnapshot: snapshot,
        agreedAmountNet: '1260',
        adjustmentAmountNet: '-10',
        requestedPickupAt: isoInstant(1),
        requestedDeliveryAt: isoInstant(1.5),
      })
      order = created.id
      await advanceFreightOrderToCompleted(request, token, order, vehicle, driver)

      const invoiced = await runFreightOrderAction(request, token, order, 'invoice')
      expect(invoiced.ok, JSON.stringify(invoiced.body)).toBeTruthy()
      salesOrderId = typeof invoiced.body?.salesOrderId === 'string' ? invoiced.body.salesOrderId : null
      salesInvoiceId = typeof invoiced.body?.salesInvoiceId === 'string' ? invoiced.body.salesInvoiceId : null
      expect(salesInvoiceId).toBeTruthy()

      // Record a partial bank transfer: 437.50 of 1437.50 gross.
      const recorded = await apiRequest(request, 'POST', PAYMENTS, {
        token,
        data: {
          orderId: order,
          amount: '437.50',
          reference: `BANK-${suffix}`,
          receivedAt: isoDate(0),
        },
        retryTransport: false,
      })
      const recordedBody = await readJsonSafe<Record<string, unknown>>(recorded)
      expect(recorded.ok(), JSON.stringify(recordedBody)).toBeTruthy()
      paymentId = typeof recordedBody?.paymentId === 'string' ? recordedBody.paymentId : null
      expect(paymentId).toBeTruthy()
      expect(recordedBody?.invoiceSynced).toBe(true)
      expect(Number(recordedBody?.paidTotalAmount)).toBeCloseTo(437.5, 2)
      expect(Number(recordedBody?.outstandingAmount)).toBeCloseTo(1000, 2)

      const invoiceAfterRecord = await fetchSalesInvoice(request, token, salesInvoiceId as string)
      expect(readNumericString(invoiceAfterRecord, ['paid_total_amount', 'paidTotalAmount'])).toBeCloseTo(437.5, 2)
      expect(readNumericString(invoiceAfterRecord, ['outstanding_amount', 'outstandingAmount'])).toBeCloseTo(1000, 2)

      // Void: the ledger and the invoice both return to zero paid.
      const voided = await apiRequest(request, 'POST', `${PAYMENTS}/void`, {
        token,
        data: { id: paymentId, reason: 'duplicate transfer' },
        retryTransport: false,
      })
      const voidedBody = await readJsonSafe<Record<string, unknown>>(voided)
      expect(voided.ok(), JSON.stringify(voidedBody)).toBeTruthy()
      expect(voidedBody?.invoiceSynced).toBe(true)

      const invoiceAfterVoid = await fetchSalesInvoice(request, token, salesInvoiceId as string)
      expect(readNumericString(invoiceAfterVoid, ['paid_total_amount', 'paidTotalAmount'])).toBeCloseTo(0, 2)
      expect(readNumericString(invoiceAfterVoid, ['outstanding_amount', 'outstandingAmount'])).toBeCloseTo(1437.5, 2)

      // An explicit resync converges on the same numbers.
      const resynced = await apiRequest(request, 'POST', `${PAYMENTS}/resync`, {
        token,
        data: { orderId: order },
        retryTransport: false,
      })
      const resyncedBody = await readJsonSafe<Record<string, unknown>>(resynced)
      expect(resynced.ok(), JSON.stringify(resyncedBody)).toBeTruthy()
      expect(resyncedBody?.invoiceSynced).toBe(true)
      expect(Number(resyncedBody?.outstandingAmount)).toBeCloseTo(1437.5, 2)
    } finally {
      if (salesInvoiceId) await deleteFreightEntityIfExists(request, token, SALES_INVOICES, salesInvoiceId)
      if (salesOrderId) await deleteFreightEntityIfExists(request, token, SALES_ORDERS, salesOrderId)
      await deleteFreightEntityIfExists(request, token, ORDERS, order)
      await deleteFreightEntityIfExists(request, token, DRIVERS, driver)
      await deleteFreightEntityIfExists(request, token, VEHICLES, vehicle)
      await deleteFreightEntityIfExists(request, token, COMPANIES, company)
    }
  })
})
