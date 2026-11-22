import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCompanyFixture } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createFreightOrderFixture,
  createTransportDriverFixture,
  createTransportVehicleFixture,
  deleteFreightEntityIfExists,
  runFreightOrderAction,
  uniqueFreightSuffix,
} from '@open-mercato/core/helpers/integration/freightFixtures'

export const integrationMeta = {
  dependsOnModules: ['freight_operations', 'transport_operations', 'customers', 'auth'],
}

const WORK = '/api/freight_operations/driver/work'
const ACTIONS = '/api/freight_operations/driver/actions'
const ORDERS = '/api/freight_operations/orders'
const DRIVERS = '/api/transport_operations/drivers'
const VEHICLES = '/api/transport_operations/vehicles'
const COMPANIES = '/api/customers/companies'

type WorkResponse = {
  driver: { id: string; fullName: string }
  orders: Array<{ id: string; status: string }>
  trips: Array<{ id: string }>
  openRestBreak: { id: string } | null
}

/**
 * TC-FREIGHT-013: a staff user linked to a driver record opens the driver
 * workspace, sees only their assigned order, starts and delivers it, takes a
 * rest break, and can raise SOS.
 */
test.describe('TC-FREIGHT-013: driver workspace', () => {
  test('assigned driver starts and delivers an order, records a break and raises SOS', async ({ request }) => {
    test.setTimeout(60_000)
    const adminToken = await getAuthToken(request)
    const { tenantId, organizationId } = getTokenContext(adminToken)
    const suffix = uniqueFreightSuffix()
    const password = `Aa1!drv${suffix.replace(/[^a-zA-Z0-9]/g, '').slice(-8)}`
    const email = `qa-driver-${suffix}@test.local`

    let roleId: string | null = null
    let userId: string | null = null
    let company: string | null = null
    let vehicle: string | null = null
    let driver: string | null = null
    let order: string | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, {
        name: `qa-driver-${suffix}`,
        tenantId,
      })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: ['freight.driver_app'],
      })
      userId = await createUserFixture(request, adminToken, {
        email,
        password,
        organizationId,
        roles: [roleId],
        name: `QA driver user ${suffix}`,
      })

      company = await createCompanyFixture(request, adminToken, `Driver PWA TC ${suffix}`)
      vehicle = await createTransportVehicleFixture(request, adminToken)
      driver = await createTransportDriverFixture(request, adminToken, { userId })
      const snapshot = { id: company, kind: 'company' as const, displayName: `Driver PWA TC ${suffix}` }
      const created = await createFreightOrderFixture(request, adminToken, {
        customerId: company,
        customerSnapshot: snapshot,
        cargoDescription: `Driver cargo ${suffix}`,
      })
      order = created.id
      expect((await runFreightOrderAction(request, adminToken, order, 'confirm')).ok).toBeTruthy()
      expect((await runFreightOrderAction(request, adminToken, order, 'assign', {
        vehicleId: vehicle,
        driverId: driver,
      })).ok).toBeTruthy()

      const driverToken = await getAuthToken(request, email, password)
      const workResponse = await apiRequest(request, 'GET', WORK, { token: driverToken })
      const work = await readJsonSafe<WorkResponse>(workResponse)
      expect(workResponse.ok(), JSON.stringify(work)).toBeTruthy()
      expect(work?.driver.id).toBe(driver)
      expect(work?.orders.map((row) => row.id)).toEqual([order])

      const start = await apiRequest(request, 'POST', ACTIONS, {
        token: driverToken,
        data: { type: 'order_dispatch', orderId: order },
        retryTransport: false,
      })
      expect(start.ok(), `driver start failed with ${start.status()}`).toBeTruthy()

      const deliver = await apiRequest(request, 'POST', ACTIONS, {
        token: driverToken,
        data: {
          type: 'order_deliver',
          orderId: order,
          podReference: `DRIVER-POD-${suffix}`,
          podReceivedByName: `Receiver ${suffix}`,
        },
        retryTransport: false,
      })
      expect(deliver.ok(), `driver deliver failed with ${deliver.status()}`).toBeTruthy()

      const deliveredWork = await apiRequest(request, 'GET', WORK, { token: driverToken })
      const deliveredBody = await readJsonSafe<WorkResponse>(deliveredWork)
      expect(deliveredBody?.orders.find((row) => row.id === order)?.status).toBe('delivered')

      const restStart = await apiRequest(request, 'POST', ACTIONS, {
        token: driverToken,
        data: { type: 'rest_start', tripId: null },
        retryTransport: false,
      })
      expect(restStart.ok(), `rest start failed with ${restStart.status()}`).toBeTruthy()
      const afterRest = await apiRequest(request, 'GET', WORK, { token: driverToken })
      const afterRestBody = await readJsonSafe<WorkResponse>(afterRest)
      expect(afterRestBody?.openRestBreak?.id).toBeTruthy()

      const restEnd = await apiRequest(request, 'POST', ACTIONS, {
        token: driverToken,
        data: { type: 'rest_end', breakId: afterRestBody?.openRestBreak?.id },
        retryTransport: false,
      })
      expect(restEnd.ok(), `rest end failed with ${restEnd.status()}`).toBeTruthy()

      const sos = await apiRequest(request, 'POST', ACTIONS, {
        token: driverToken,
        data: { type: 'sos', orderId: order, note: `SOS ${suffix}` },
        retryTransport: false,
      })
      expect(sos.ok(), `sos failed with ${sos.status()}`).toBeTruthy()
    } finally {
      await deleteFreightEntityIfExists(request, adminToken, ORDERS, order)
      await deleteFreightEntityIfExists(request, adminToken, DRIVERS, driver)
      await deleteFreightEntityIfExists(request, adminToken, VEHICLES, vehicle)
      await deleteFreightEntityIfExists(request, adminToken, COMPANIES, company)
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
