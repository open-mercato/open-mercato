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
  getFreightOrderFixture,
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

type ListResponse = { items?: Array<Record<string, unknown>> }

async function fetchFirst(request: Parameters<typeof apiRequest>[0], token: string, path: string): Promise<Record<string, unknown> | null> {
  const response = await apiRequest(request, 'GET', path, { token })
  const body = await readJsonSafe<ListResponse>(response)
  if (!response.ok()) return null
  return body?.items?.[0] ?? null
}

/**
 * TC-FREIGHT-004: invoicing a completed spot order creates the sales
 * order → invoice pair through the command bus, with the halala-exact totals,
 * and the pair is refused a second time.
 *
 * The amount math is deliberate: 1260 − 10 = 1250 net, 15% VAT = 187.50,
 * gross 1437.50 — asserted against BOTH the freight ledger input and the sales
 * documents the calculation service produced, because the bridge's whole job is
 * that those two never drift.
 */
test.describe('TC-FREIGHT-004: spot order invoicing through the sales bridge', () => {
  test('the invoice pair exists with exact VAT math; a second invoice refuses', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueFreightSuffix()
    const company = await createCompanyFixture(request, token, `Invoice TC ${suffix}`)
    const snapshot = { id: company, kind: 'company' as const, displayName: `Invoice TC ${suffix}` }

    let order: string | null = null
    let vehicle: string | null = null
    let driver: string | null = null
    let salesOrderId: string | null = null
    let salesInvoiceId: string | null = null

    try {
      vehicle = await createTransportVehicleFixture(request, token)
      driver = await createTransportDriverFixture(request, token)
      const created = await createFreightOrderFixture(request, token, {
        customerId: company,
        customerSnapshot: snapshot,
        cargoDescription: `Cement ${suffix}`,
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
      expect(salesOrderId).toBeTruthy()
      expect(salesInvoiceId).toBeTruthy()
      expect(typeof invoiced.body?.salesInvoiceNumber === 'string' && String(invoiced.body.salesInvoiceNumber).length > 0).toBe(true)

      const orderRow = await getFreightOrderFixture(request, token, order)
      expect(orderRow?.status).toBe('invoiced')
      expect(orderRow?.sales_order_id).toBe(salesOrderId)
      expect(orderRow?.sales_invoice_id).toBe(salesInvoiceId)

      const salesInvoice = await fetchFirst(request, token, `${SALES_INVOICES}?ids=${salesInvoiceId}&pageSize=1`)
      expect(salesInvoice, 'the sales invoice must exist').not.toBeNull()
      expect(salesInvoice?.order_id).toBe(salesOrderId)
      expect(readNumericString(salesInvoice, ['grand_total_gross_amount', 'grandTotalGrossAmount'])).toBeCloseTo(1437.5, 2)
      expect(readNumericString(salesInvoice, ['tax_total_amount', 'taxTotalAmount'])).toBeCloseTo(187.5, 2)

      const salesOrder = await fetchFirst(request, token, `${SALES_ORDERS}?ids=${salesOrderId}&pageSize=1`)
      expect(salesOrder, 'the sales order must exist').not.toBeNull()
      expect(salesOrder?.customer_entity_id ?? salesOrder?.customerEntityId).toBe(company)
      expect(readNumericString(salesOrder, ['grand_total_gross_amount', 'grandTotalGrossAmount'])).toBeCloseTo(1437.5, 2)

      const second = await runFreightOrderAction(request, token, order, 'invoice')
      expect(second.status).toBe(409)

      const deletion = await apiRequest(request, 'DELETE', ORDERS, {
        token,
        data: { id: order },
        retryTransport: false,
      })
      expect(deletion.status(), 'an invoiced order must not be deletable').toBe(409)
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
