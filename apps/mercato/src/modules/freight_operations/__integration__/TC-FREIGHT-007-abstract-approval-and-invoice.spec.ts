import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCompanyFixture } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  activateFreightContractFixture,
  advanceFreightTripToDelivered,
  createFreightContractFixture,
  createFreightContractRouteFixture,
  createFreightTripFixture,
  deleteFreightEntityIfExists,
  generateFreightAbstractFixture,
  getFreightAbstractFixture,
  getFreightTripFixture,
  isoDate,
  runFreightAbstractAction,
  uniqueFreightSuffix,
} from '@open-mercato/core/helpers/integration/freightFixtures'

export const integrationMeta = {
  dependsOnModules: ['freight_operations', 'customers', 'sales', 'transport_operations'],
}

const COMPANIES = '/api/customers/companies'
const CONTRACTS = '/api/freight_operations/contracts'
const CONTRACT_ROUTES = '/api/freight_operations/contract-routes'
const TRIPS = '/api/freight_operations/trips'
const PAYMENTS = '/api/freight_operations/payments'
const SALES_ORDERS = '/api/sales/orders'
const SALES_INVOICES = '/api/sales/invoices'

type RequestContext = Parameters<typeof apiRequest>[0]

async function fetchSalesInvoice(
  request: RequestContext,
  token: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const response = await apiRequest(request, 'GET', `${SALES_INVOICES}?ids=${id}&pageSize=1`, { token })
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
  if (!response.ok()) return null
  return body?.items?.[0] ?? null
}

/**
 * TC-FREIGHT-007: the three ways an abstract becomes invoiceable, the sales
 * bridge behind `invoice`, and the release a cancellation performs.
 *
 * The contract's `requiresCustomerApproval` is the switch: off means staff
 * finalize internally and the customer gate is refused, on means the customer
 * decides (in the portal, or through an offline approval staff record).
 */
test.describe('TC-FREIGHT-007: abstract approval routes, invoicing and cancellation', () => {
  test('finalize, offline approval, invoicing, payments and cancel behave by contract setting', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueFreightSuffix()
    const company = await createCompanyFixture(request, token, `Approval TC ${suffix}`)
    const snapshot = { id: company, kind: 'company' as const, displayName: `Approval TC ${suffix}` }

    let contractInternal: string | null = null
    let contractCustomer: string | null = null
    let rateLineInternal: string | null = null
    let rateLineCustomer: string | null = null
    let internalTrip: string | null = null
    let customerTrip: string | null = null
    let internalAbstract: string | null = null
    let customerAbstract: string | null = null
    let paymentId: string | null = null
    let salesInvoiceId: string | null = null
    let salesOrderId: string | null = null

    try {
      contractInternal = (await createFreightContractFixture(request, token, {
        customerId: company,
        customerSnapshot: snapshot,
        requiresCustomerApproval: false,
        paymentTermsDays: 15,
        title: `Internal TC ${suffix}`,
      })).id
      contractCustomer = (await createFreightContractFixture(request, token, {
        customerId: company,
        customerSnapshot: snapshot,
        requiresCustomerApproval: true,
        title: `Customer TC ${suffix}`,
      })).id
      rateLineInternal = await createFreightContractRouteFixture(request, token, contractInternal, { rateAmount: '450' })
      rateLineCustomer = await createFreightContractRouteFixture(request, token, contractCustomer, { rateAmount: '450' })
      await activateFreightContractFixture(request, token, contractInternal)
      await activateFreightContractFixture(request, token, contractCustomer)

      internalTrip = await createFreightTripFixture(request, token, { contractId: contractInternal, contractRouteId: rateLineInternal })
      await advanceFreightTripToDelivered(request, token, internalTrip)
      customerTrip = await createFreightTripFixture(request, token, { contractId: contractCustomer, contractRouteId: rateLineCustomer })
      await advanceFreightTripToDelivered(request, token, customerTrip)

      internalAbstract = await generateFreightAbstractFixture(request, token, { contractId: contractInternal })
      customerAbstract = await generateFreightAbstractFixture(request, token, { contractId: contractCustomer })

      // The customer gate only exists when the contract asks for it.
      const submitWaived = await runFreightAbstractAction(request, token, internalAbstract, 'submit')
      expect(submitWaived.status).toBe(409)
      const finalizeGated = await runFreightAbstractAction(request, token, customerAbstract, 'finalize', { note: 'Not ours to decide' })
      expect(finalizeGated.status).toBe(409)

      const finalized = await runFreightAbstractAction(request, token, internalAbstract, 'finalize', {
        note: 'Rates confirmed with the customer by phone; contract waives the gate.',
      })
      expect(finalized.ok, JSON.stringify(finalized.body)).toBeTruthy()
      const finalizedRow = await getFreightAbstractFixture(request, token, internalAbstract)
      expect(finalizedRow?.status).toBe('approved')
      expect(finalizedRow?.approval_mode).toBe('staff_internal')

      // The customer-gated abstract takes the offline approval route instead.
      const submitted = await runFreightAbstractAction(request, token, customerAbstract, 'submit')
      expect(submitted.ok, JSON.stringify(submitted.body)).toBeTruthy()
      const offline = await runFreightAbstractAction(request, token, customerAbstract, 'record-offline-approval', {
        reference: `EMAIL-${suffix}`,
        note: 'Customer approved the abstract by email.',
      })
      expect(offline.ok, JSON.stringify(offline.body)).toBeTruthy()
      const offlineRow = await getFreightAbstractFixture(request, token, customerAbstract)
      expect(offlineRow?.status).toBe('approved')
      expect(offlineRow?.approval_mode).toBe('customer_offline')

      // Invoicing: one sales order + invoice pair, totalled to the halala.
      const invoiced = await runFreightAbstractAction(request, token, internalAbstract, 'invoice')
      expect(invoiced.ok, JSON.stringify(invoiced.body)).toBeTruthy()
      salesInvoiceId = typeof invoiced.body?.salesInvoiceId === 'string' ? invoiced.body.salesInvoiceId : null
      salesOrderId = typeof invoiced.body?.salesOrderId === 'string' ? invoiced.body.salesOrderId : null
      expect(salesInvoiceId).toBeTruthy()

      const invoicedRow = await getFreightAbstractFixture(request, token, internalAbstract)
      expect(invoicedRow?.status).toBe('invoiced')
      expect(invoicedRow?.sales_invoice_id).toBe(salesInvoiceId)
      expect(typeof invoicedRow?.sales_invoice_number).toBe('string')
      expect(Number(invoicedRow?.outstanding_amount)).toBe(517.5)
      expect((await getFreightTripFixture(request, token, internalTrip))?.billing_status).toBe('billed')

      const salesInvoice = await fetchSalesInvoice(request, token, salesInvoiceId as string)
      expect(salesInvoice).not.toBeNull()
      expect(Number(salesInvoice?.grand_total_gross_amount)).toBe(517.5)

      // A second invoice call cannot double-bill, and an invoiced abstract is final.
      const secondInvoice = await runFreightAbstractAction(request, token, internalAbstract, 'invoice')
      expect(secondInvoice.status).toBe(409)
      const cancelInvoiced = await runFreightAbstractAction(request, token, internalAbstract, 'cancel', { reason: 'Too late' })
      expect(cancelInvoiced.status).toBe(409)

      // Payments land on the abstract's own outstanding amount.
      const recorded = await apiRequest(request, 'POST', PAYMENTS, {
        token,
        data: {
          abstractId: internalAbstract,
          amount: '200',
          receivedAt: isoDate(0),
          reference: `TRF-${suffix}`,
        },
        retryTransport: false,
      })
      const recordedBody = await readJsonSafe<{ paymentId?: string; outstandingAmount?: string }>(recorded)
      expect(recorded.ok(), JSON.stringify(recordedBody)).toBeTruthy()
      paymentId = recordedBody?.paymentId ?? null
      expect(Number(recordedBody?.outstandingAmount)).toBe(317.5)
      expect(Number((await getFreightAbstractFixture(request, token, internalAbstract))?.outstanding_amount)).toBe(317.5)

      const voided = await apiRequest(request, 'POST', `${PAYMENTS}/void`, {
        token,
        data: { id: paymentId, reason: 'Wrong transfer' },
        retryTransport: false,
      })
      expect(voided.ok(), JSON.stringify(await readJsonSafe(voided))).toBeTruthy()
      expect(Number((await getFreightAbstractFixture(request, token, internalAbstract))?.outstanding_amount)).toBe(517.5)

      // Cancelling the customer-gated abstract releases its trip and zeroes the totals.
      const cancelled = await runFreightAbstractAction(request, token, customerAbstract, 'cancel', { reason: 'Re-issued on the next abstract' })
      expect(cancelled.ok, JSON.stringify(cancelled.body)).toBeTruthy()
      const cancelledRow = await getFreightAbstractFixture(request, token, customerAbstract)
      expect(cancelledRow?.status).toBe('cancelled')
      expect(cancelledRow?.cancellation_reason).toBe('Re-issued on the next abstract')
      expect(cancelledRow?.trip_count).toBe(0)
      expect(Number(cancelledRow?.grand_total_gross_amount)).toBe(0)
      expect((await getFreightTripFixture(request, token, customerTrip))?.billing_status).toBe('unbilled')

      const invoiceCancelled = await runFreightAbstractAction(request, token, customerAbstract, 'invoice')
      expect(invoiceCancelled.status).toBe(409)
    } finally {
      if (paymentId) {
        await apiRequest(request, 'POST', `${PAYMENTS}/void`, {
          token,
          data: { id: paymentId, reason: 'teardown' },
          retryTransport: false,
        }).catch(() => undefined)
      }
      if (internalAbstract) {
        await runFreightAbstractAction(request, token, internalAbstract, 'cancel', { reason: 'teardown' })
      }
      if (customerAbstract) {
        await runFreightAbstractAction(request, token, customerAbstract, 'cancel', { reason: 'teardown' })
      }
      // The sales pair is removed first: the freight side keeps its invoice link
      // forever by design, so an invoiced trip deliberately survives cleanup.
      if (salesInvoiceId) await deleteFreightEntityIfExists(request, token, SALES_INVOICES, salesInvoiceId)
      if (salesOrderId) await deleteFreightEntityIfExists(request, token, SALES_ORDERS, salesOrderId)
      await deleteFreightEntityIfExists(request, token, TRIPS, internalTrip)
      await deleteFreightEntityIfExists(request, token, TRIPS, customerTrip)
      await deleteFreightEntityIfExists(request, token, CONTRACT_ROUTES, rateLineInternal)
      await deleteFreightEntityIfExists(request, token, CONTRACT_ROUTES, rateLineCustomer)
      await deleteFreightEntityIfExists(request, token, CONTRACTS, contractInternal)
      await deleteFreightEntityIfExists(request, token, CONTRACTS, contractCustomer)
      await deleteFreightEntityIfExists(request, token, COMPANIES, company)
    }
  })
})
