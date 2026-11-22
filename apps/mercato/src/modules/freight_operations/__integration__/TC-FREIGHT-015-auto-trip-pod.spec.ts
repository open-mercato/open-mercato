import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCompanyFixture } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  createFreightOrderFixture,
  createTransportDriverFixture,
  createTransportVehicleFixture,
  deleteFreightEntityIfExists,
  runFreightOrderAction,
  uniqueFreightSuffix,
} from '@open-mercato/core/helpers/integration/freightFixtures'

export const integrationMeta = {
  dependsOnModules: ['freight_operations', 'customers', 'transport_operations'],
}

const SETTINGS = '/api/freight_operations/settings'
const ORDERS = '/api/freight_operations/orders'
const TRIPS = '/api/freight_operations/trips'
const COMPANIES = '/api/customers/companies'
const VEHICLES = '/api/transport_operations/vehicles'
const DRIVERS = '/api/transport_operations/drivers'

type TripRow = { id: string; freight_order_id: string; vehicle_id: string | null; driver_id: string | null }

/**
 * TC-FREIGHT-015: with auto-trip enabled, confirming an order creates a linked
 * trip and assignment is copied to it. The POD gate on completion is honoured,
 * and a delivered order can still receive its POD afterwards.
 */
test.describe('TC-FREIGHT-015: auto-created trip and POD completion gate', () => {
  test('confirm creates a trip, assignment syncs, and completion requires a POD', async ({ request }) => {
    test.setTimeout(60_000)
    const token = await getAuthToken(request)
    const suffix = uniqueFreightSuffix()
    let company: string | null = null
    let vehicle: string | null = null
    let driver: string | null = null
    let order: string | null = null
    let trip: string | null = null

    try {
      const enable = await apiRequest(request, 'PUT', SETTINGS, {
        token,
        data: { autoCreateTripOnConfirm: true, requirePodForBilling: false },
      })
      expect(enable.ok(), `PUT ${SETTINGS} failed with ${enable.status()}`).toBeTruthy()

      company = await createCompanyFixture(request, token, `Auto trip TC ${suffix}`)
      vehicle = await createTransportVehicleFixture(request, token)
      driver = await createTransportDriverFixture(request, token)
      const snapshot = { id: company, kind: 'company' as const, displayName: `Auto trip TC ${suffix}` }
      const created = await createFreightOrderFixture(request, token, {
        customerId: company,
        customerSnapshot: snapshot,
        cargoDescription: `Auto trip cargo ${suffix}`,
      })
      order = created.id
      expect((await runFreightOrderAction(request, token, order, 'confirm')).ok).toBeTruthy()

      const tripsResponse = await apiRequest(
        request,
        'GET',
        `${TRIPS}?freightOrderId=${encodeURIComponent(order)}&pageSize=10`,
        { token },
      )
      const tripsBody = await readJsonSafe<{ items?: TripRow[] }>(tripsResponse)
      expect(tripsResponse.ok(), JSON.stringify(tripsBody)).toBeTruthy()
      expect(tripsBody?.items).toHaveLength(1)
      trip = tripsBody?.items?.[0]?.id ?? null
      expect(trip).toBeTruthy()
      expect(tripsBody?.items?.[0]?.driver_id).toBeNull()

      expect((await runFreightOrderAction(request, token, order, 'assign', {
        vehicleId: vehicle,
        driverId: driver,
      })).ok).toBeTruthy()
      const assignedTrips = await apiRequest(
        request,
        'GET',
        `${TRIPS}?freightOrderId=${encodeURIComponent(order)}&pageSize=10`,
        { token },
      )
      const assignedBody = await readJsonSafe<{ items?: TripRow[] }>(assignedTrips)
      expect(assignedBody?.items?.[0]?.driver_id).toBe(driver)
      expect(assignedBody?.items?.[0]?.vehicle_id).toBe(vehicle)

      expect((await runFreightOrderAction(request, token, order, 'dispatch')).ok).toBeTruthy()
      expect((await runFreightOrderAction(request, token, order, 'deliver')).ok).toBeTruthy()

      const blocked = await runFreightOrderAction(request, token, order, 'complete')
      expect(blocked.status, 'completion without a POD must be refused').toBe(409)

      const savePod = await runFreightOrderAction(request, token, order, 'deliver', {
        podReference: `POD-${suffix}`,
      })
      expect(savePod.ok, JSON.stringify(savePod.body)).toBeTruthy()
      expect((await runFreightOrderAction(request, token, order, 'complete')).ok).toBeTruthy()
    } finally {
      await apiRequest(request, 'PUT', SETTINGS, { token, data: { autoCreateTripOnConfirm: false } }).catch(() => undefined)
      await deleteFreightEntityIfExists(request, token, TRIPS, trip)
      await deleteFreightEntityIfExists(request, token, ORDERS, order)
      await deleteFreightEntityIfExists(request, token, DRIVERS, driver)
      await deleteFreightEntityIfExists(request, token, VEHICLES, vehicle)
      await deleteFreightEntityIfExists(request, token, COMPANIES, company)
    }
  })
})
