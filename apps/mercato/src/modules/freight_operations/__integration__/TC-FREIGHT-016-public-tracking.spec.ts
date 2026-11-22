import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCompanyFixture } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  createFreightOrderFixture,
  deleteFreightEntityIfExists,
  uniqueFreightSuffix,
} from '@open-mercato/core/helpers/integration/freightFixtures'

export const integrationMeta = {
  dependsOnModules: ['freight_operations', 'customers'],
}

const LINK = '/api/freight_operations/orders/tracking-link'
const PUBLIC = '/api/freight_operations/public/tracking'
const ORDERS = '/api/freight_operations/orders'
const COMPANIES = '/api/customers/companies'

/**
 * TC-FREIGHT-016: staff can mint a public tracking token for an order, and the
 * unauthenticated endpoint returns only the non-sensitive tracking status.
 */
test.describe('TC-FREIGHT-016: public order tracking', () => {
  test('a tracking token exposes the order status without authentication', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueFreightSuffix()
    let company: string | null = null
    let order: string | null = null

    try {
      company = await createCompanyFixture(request, token, `Public tracking TC ${suffix}`)
      const created = await createFreightOrderFixture(request, token, {
        customerId: company,
        customerSnapshot: { id: company, kind: 'company', displayName: `Public tracking TC ${suffix}` },
        cargoDescription: `Tracking cargo ${suffix}`,
      })
      order = created.id

      const linkResponse = await apiRequest(request, 'POST', LINK, {
        token,
        data: { id: order },
        retryTransport: false,
      })
      const link = await readJsonSafe<{ trackingToken?: string }>(linkResponse)
      expect(linkResponse.ok(), JSON.stringify(link)).toBeTruthy()
      const trackingToken = link?.trackingToken
      expect(trackingToken).toBeTruthy()

      const publicResponse = await request.get(`${PUBLIC}?token=${encodeURIComponent(trackingToken as string)}`)
      const publicBody = await readJsonSafe<{ orderNumber?: string; status?: string; cargoDescription?: string }>(publicResponse)
      expect(publicResponse.status(), JSON.stringify(publicBody)).toBe(200)
      expect(publicBody?.orderNumber).toBe(created.orderNumber)
      expect(publicBody?.status).toBe('draft')
      expect(publicBody?.cargoDescription).toBe(`Tracking cargo ${suffix}`)

      const invalid = await request.get(`${PUBLIC}?token=not-a-real-token`)
      expect(invalid.status()).toBe(404)
    } finally {
      await deleteFreightEntityIfExists(request, token, ORDERS, order)
      await deleteFreightEntityIfExists(request, token, COMPANIES, company)
    }
  })
})
