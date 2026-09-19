import { expect, test } from '@playwright/test'
import {
  createSalesOrderFixture,
  createOrderLineFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  numeric,
  readDocument,
  restoreDefaultTaxProvider,
  setTaxProvider,
  type JsonMap,
} from './helpers/taxProvider'

/**
 * TC-SALES-TAX-006 — Phase 4 of .ai/specs/2026-09-19-pluggable-tax-providers.md.
 *
 * An exempt customer must produce zero tax and say WHY: the status is `exempt`,
 * not `calculated` with a coincidental zero, and the exempt total equals the
 * taxable total so an accountant can see what was not charged.
 *
 * The exemption travels customer row → customer snapshot → TaxCustomer →
 * provider, so this spec is the end to end proof of the whole Phase 4 chain.
 */
test.describe('TC-SALES-TAX-006: an exempt customer is charged no tax, and the document says why', () => {
  test('a document for an exempt customer records the exempt status', async ({ request }) => {
    test.slow()

    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null
    let customerId: string | null = null

    try {
      // A customer marked exempt with a reason code and a certificate.
      const customerResponse = await apiRequest(request, 'POST', '/api/customers/companies', {
        token,
        retryTransport: false,
        data: {
          displayName: `TC-SALES-TAX-006 Exempt Co ${Date.now()}`,
          isTaxExempt: true,
          taxExemptionCode: 'RESALE',
          taxExemptionCertificate: 'CERT-TC006',
        },
      })
      const customerText = await customerResponse.text()
      expect(
        customerResponse.ok(),
        `POST /api/customers/companies failed: ${customerResponse.status()} ${customerText.slice(0, 400)}`,
      ).toBeTruthy()
      const customerBody = JSON.parse(customerText) as JsonMap
      customerId = (customerBody.id ?? customerBody.companyId ?? customerBody.entityId) as string
      expect(customerId).toBeTruthy()

      // The certificate must read back decrypted, not as ciphertext.
      const customerList = await apiRequest(request, 'GET', `/api/customers/companies?id=${customerId}`, {
        token,
        retryTransport: false,
      })
      const listBody = JSON.parse(await customerList.text()) as JsonMap
      const customers = Array.isArray(listBody.items) ? (listBody.items as JsonMap[]) : []
      expect(customers.length).toBeGreaterThan(0)
      expect(customers[0].is_tax_exempt).toBe(true)
      expect(customers[0].tax_exemption_code).toBe('RESALE')
      expect(customers[0].tax_exemption_certificate).toBe('CERT-TC006')

      // fixed-rate at 5% would otherwise charge tax; the exemption must win.
      await setTaxProvider(request, token, {
        providerKey: 'fixed-rate',
        providerSettings: { rate: 5, jurisdictionName: 'State' },
      })

      orderId = await createSalesOrderFixture(request, token)
      await apiRequest(request, 'PUT', '/api/sales/orders', {
        token,
        retryTransport: false,
        data: { id: orderId, customerEntityId: customerId },
      })
      await createOrderLineFixture(request, token, orderId, {
        name: `TC-SALES-TAX-006 line ${Date.now()}`,
        quantity: 1,
        unitPriceNet: 100,
        unitPriceGross: 120,
        taxRate: 20,
      })

      const order = await readDocument(request, token, '/api/sales/orders', orderId)

      expect(order.taxStatus).toBe('exempt')
      expect(numeric(order.taxTotalAmount)).toBe(0)

      const taxInfo = order.taxInfo as JsonMap
      expect(taxInfo).toBeTruthy()
      expect(taxInfo.status).toBe('exempt')
      const totals = taxInfo.totals as JsonMap
      // An accountant must be able to see what was NOT charged.
      expect(numeric(totals.taxTotal)).toBe(0)
      expect(numeric(totals.exemptTotal)).toBeCloseTo(numeric(totals.taxableTotal), 4)

      // The stored document must not leak the certificate number.
      expect(JSON.stringify(taxInfo)).not.toContain('CERT-TC006')
    } finally {
      await restoreDefaultTaxProvider(request, token)
      if (orderId) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      if (customerId) await deleteSalesEntityIfExists(request, token, '/api/customers/companies', customerId)
    }
  })
})
