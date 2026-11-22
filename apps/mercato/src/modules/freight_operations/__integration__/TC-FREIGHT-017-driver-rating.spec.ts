import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCustomerCompanyFixture,
  createCustomerRoleFixture,
  createCustomerUserFixture,
  deleteCustomerCompanyFixture,
  deleteCustomerRoleFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import {
  createTransportDriverFixture,
  createTransportVehicleFixture,
  deleteFreightEntityIfExists,
  runFreightOrderAction,
  uniqueFreightSuffix,
} from '@open-mercato/core/helpers/integration/freightFixtures'

export const integrationMeta = {
  dependsOnModules: ['freight_operations', 'customers', 'customer_accounts', 'transport_operations'],
}

const PORTAL_ORDERS = '/api/portal/freight/orders'
const PORTAL_RATINGS = '/api/portal/freight/ratings'
const STAFF_ORDERS = '/api/freight_operations/orders'
const DRIVERS = '/api/transport_operations/drivers'
const VEHICLES = '/api/transport_operations/vehicles'
const COMPANIES = '/api/customers/companies'

/**
 * TC-FREIGHT-017: a customer rates the driver of a delivered portal order, and
 * the rating appears on their portal order list.
 */
test.describe('TC-FREIGHT-017: driver rating', () => {
  test('the customer rates the driver after delivery and sees the rating', async ({ request }) => {
    test.setTimeout(60_000)
    const adminToken = await getAuthToken(request)
    const { tenantId } = getTokenContext(adminToken)
    const suffix = uniqueFreightSuffix()
    let roleId: string | null = null
    let userId: string | null = null
    let company: string | null = null
    let vehicle: string | null = null
    let driver: string | null = null
    let order: string | null = null

    try {
      const role = await createCustomerRoleFixture(request, adminToken, {
        features: ['portal.freight.view', 'portal.freight.orders.create', 'portal.freight.rate'],
      })
      roleId = role.id
      company = await createCustomerCompanyFixture(request, adminToken, `Rating TC ${suffix}`)
      const user = await createCustomerUserFixture(request, adminToken, {
        roleIds: [role.id],
        customerEntityId: company,
      })
      userId = user.id
      vehicle = await createTransportVehicleFixture(request, adminToken)
      driver = await createTransportDriverFixture(request, adminToken)

      const session = await portalLogin(request, {
        email: user.email,
        password: user.password,
        tenantId,
      })
      const submit = await request.post(PORTAL_ORDERS, {
        headers: portalCookieHeaders(session, { 'Content-Type': 'application/json' }),
        data: {
          cargoDescription: `Rating cargo ${suffix}`,
          pickupLocation: 'Riyadh',
          dropoffLocation: 'Dammam',
        },
      })
      const submitted = await readJsonSafe<{ orderId?: string }>(submit)
      expect(submit.status(), JSON.stringify(submitted)).toBe(201)
      order = submitted?.orderId ?? null
      expect(order).toBeTruthy()

      expect((await runFreightOrderAction(request, adminToken, order as string, 'confirm')).ok).toBeTruthy()
      expect((await runFreightOrderAction(request, adminToken, order as string, 'assign', {
        vehicleId: vehicle,
        driverId: driver,
      })).ok).toBeTruthy()
      expect((await runFreightOrderAction(request, adminToken, order as string, 'dispatch')).ok).toBeTruthy()
      expect((await runFreightOrderAction(request, adminToken, order as string, 'deliver', {
        podReference: `RATING-POD-${suffix}`,
      })).ok).toBeTruthy()
      expect((await runFreightOrderAction(request, adminToken, order as string, 'complete')).ok).toBeTruthy()

      const rate = await request.post(PORTAL_RATINGS, {
        headers: portalCookieHeaders(session, { 'Content-Type': 'application/json' }),
        data: { orderId: order, rating: 5, comment: `Great driver ${suffix}` },
      })
      const rated = await readJsonSafe<{ rating?: number }>(rate)
      expect(rate.status(), JSON.stringify(rated)).toBe(200)
      expect(rated?.rating).toBe(5)

      const list = await request.get(PORTAL_ORDERS, { headers: portalCookieHeaders(session) })
      const body = await readJsonSafe<{
        items?: Array<{ id: string; driverRating?: { rating: number | null; comment: string | null } | null }>
      }>(list)
      expect(list.ok()).toBeTruthy()
      const row = body?.items?.find((item) => item.id === order)
      expect(row?.driverRating?.rating).toBe(5)
      expect(row?.driverRating?.comment).toBe(`Great driver ${suffix}`)
    } finally {
      await deleteFreightEntityIfExists(request, adminToken, STAFF_ORDERS, order)
      await deleteFreightEntityIfExists(request, adminToken, DRIVERS, driver)
      await deleteFreightEntityIfExists(request, adminToken, VEHICLES, vehicle)
      await deleteCustomerUserFixture(request, adminToken, userId)
      await deleteCustomerRoleFixture(request, adminToken, roleId)
      await deleteCustomerCompanyFixture(request, adminToken, company)
    }
  })
})
