import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createCustomerCompanyFixture,
  deleteCustomerCompanyFixture,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import {
  canManageSalesOrders,
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import {
  cleanupDraftClaimWithLines,
  readWarrantyClaimSettings,
  uniqueLabel,
} from './helpers'

test.describe('TC-WC-015: warranty claims bug regressions', () => {
  test('keeps order picker grants reachable and hardens order-less core exchange intake validation', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-015')
    let customerId: string | null = null
    let claimId: string | null = null

    try {
      const settings = await readWarrantyClaimSettings(request, adminToken)
      expect(settings.slaHours, 'settings endpoint should be reachable for the desk/admin role').toBeGreaterThan(0)

      const ordersResponse = await apiRequest(request, 'GET', '/api/sales/orders?pageSize=1', { token: adminToken })
      expect(
        ordersResponse.status(),
        'seeded desk/admin role should be able to reach the sales order picker endpoint',
      ).toBe(200)

      customerId = await createCustomerCompanyFixture(request, adminToken, `QA WC Core Exchange Customer ${stamp}`)

      const createResponse = await apiRequest(request, 'POST', '/api/warranty_claims', {
        token: adminToken,
        data: {
          claimType: 'core_return',
          channel: 'staff',
          customerId,
          orderId: null,
          reasonCode: 'core-exchange',
          currencyCode: 'USD',
          lines: [
            {
              lineNo: 1,
              sku: `WC-015-CORE-${stamp}`,
              productName: 'QA core exchange product',
              faultDescription: 'Order-less core exchange line',
              qtyClaimed: 1,
              coreCreditAmount: 18,
            },
          ],
        },
      })
      const createBody = await readJsonSafe<{ id?: string | null; error?: string }>(createResponse)
      expect(
        createResponse.status(),
        `order-less core exchange create should return 201, not 500: ${JSON.stringify(createBody)}`,
      ).toBe(201)
      expect(createBody?.id, 'created core exchange claim should include id').toBeTruthy()
      claimId = createBody?.id ?? null

      const invalidCustomerResponse = await apiRequest(request, 'POST', '/api/warranty_claims', {
        token: adminToken,
        data: {
          claimType: 'core_return',
          channel: 'staff',
          customerId: randomUUID(),
          orderId: null,
          reasonCode: 'core-exchange',
          currencyCode: 'USD',
          lines: [
            {
              lineNo: 1,
              sku: `WC-015-BAD-CUSTOMER-${stamp}`,
              productName: 'QA invalid customer core exchange product',
              faultDescription: 'Invalid customer should map to 400',
              qtyClaimed: 1,
              coreCreditAmount: 18,
            },
          ],
        },
      })
      const invalidCustomerBody = await readJsonSafe<{ error?: string }>(invalidCustomerResponse)
      expect(
        invalidCustomerResponse.status(),
        `invalid customer reference should return 400, not 500: ${JSON.stringify(invalidCustomerBody)}`,
      ).toBe(400)
    } finally {
      await cleanupDraftClaimWithLines(request, adminToken, claimId)
      await deleteCustomerCompanyFixture(request, adminToken, customerId)
    }
  })

  test('snapshots the referenced order number onto the claim and matches it in desk search', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-015-ordno')
    let orderId: string | null = null
    let claimId: string | null = null

    try {
      if (!(await canManageSalesOrders(request, adminToken))) {
        test.skip(true, 'sales order management is unavailable for the admin role on this database')
      }
      orderId = await createSalesOrderFixture(request, adminToken)
      const orderRead = await apiRequest(request, 'GET', `/api/sales/orders?id=${encodeURIComponent(orderId)}&pageSize=1`, { token: adminToken })
      const orderBody = await readJsonSafe<{ items?: Array<{ id?: string; orderNumber?: string | null }> }>(orderRead)
      const orderNumber = orderBody?.items?.[0]?.orderNumber ?? null
      expect(orderNumber, 'sales order fixture should expose an order number').toBeTruthy()

      const createResponse = await apiRequest(request, 'POST', '/api/warranty_claims', {
        token: adminToken,
        data: {
          claimType: 'warranty',
          channel: 'staff',
          orderId,
          currencyCode: 'USD',
          lines: [
            {
              lineNo: 1,
              sku: `WC-015-ORDNO-${stamp}`,
              productName: 'QA order snapshot product',
              qtyClaimed: 1,
            },
          ],
        },
      })
      const createBody = await readJsonSafe<{ id?: string | null }>(createResponse)
      expect(createResponse.status(), 'claim create with a real order should return 201').toBe(201)
      claimId = createBody?.id ?? null

      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/warranty_claims?id=${encodeURIComponent(claimId!)}`,
        { token: adminToken },
      )
      const listBody = await readJsonSafe<{ items?: Array<{ orderNumber?: string | null }> }>(listResponse)
      expect(
        listBody?.items?.[0]?.orderNumber,
        'claim list payload should carry the snapshotted order number',
      ).toBe(orderNumber)

      const searchResponse = await apiRequest(
        request,
        'GET',
        `/api/warranty_claims?search=${encodeURIComponent(orderNumber!)}&pageSize=100`,
        { token: adminToken },
      )
      const searchBody = await readJsonSafe<{ items?: Array<{ id?: string }> }>(searchResponse)
      expect(
        searchBody?.items?.some((item) => item.id === claimId),
        'desk search by order number should find the claim',
      ).toBe(true)
    } finally {
      await cleanupDraftClaimWithLines(request, adminToken, claimId)
      if (orderId) await deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', orderId)
    }
  })
})
