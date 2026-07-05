import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createCustomerCompanyFixture,
  deleteCustomerCompanyFixture,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
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
})
