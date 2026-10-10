import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  createFreightOrderFixture,
  createTransportDriverFixture,
  createTransportVehicleFixture,
  deleteFreightEntityIfExists,
  isoDate,
  isoInstant,
  runFreightOrderAction,
  uniqueFreightSuffix,
} from '@open-mercato/core/helpers/integration/freightFixtures'

export const integrationMeta = {
  dependsOnModules: ['freight_operations', 'customers', 'transport_operations'],
}

const ORDERS = '/api/freight_operations/orders'
const COMPANIES = '/api/customers/companies'
const VEHICLES = '/api/transport_operations/vehicles'
const DRIVERS = '/api/transport_operations/drivers'

/**
 * TC-FREIGHT-003: the assignment rules borrowed from the fleet board hold.
 *
 * A vehicle under maintenance, a suspended driver, an expired licence, and an
 * overlapping job on the same truck each refuse the assignment — and the same
 * assignment succeeds once the blocker is gone, so the negative cases cannot
 * pass by refusing everything.
 */
test.describe('TC-FREIGHT-003: freight order assignment availability', () => {
  test('unavailable resources refuse, available ones succeed, overlap refuses', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueFreightSuffix()
    const company = await createCompanyFixture(request, token, `Availability TC ${suffix}`)
    const snapshot = { id: company, kind: 'company' as const, displayName: `Availability TC ${suffix}` }

    const cleanup: Array<{ path: string; id: string | null }> = []

    try {
      const activeVehicle = await createTransportVehicleFixture(request, token)
      cleanup.push({ path: VEHICLES, id: activeVehicle })
      const availableDriver = await createTransportDriverFixture(request, token)
      cleanup.push({ path: DRIVERS, id: availableDriver })
      const maintenanceVehicle = await createTransportVehicleFixture(request, token, { status: 'maintenance' })
      cleanup.push({ path: VEHICLES, id: maintenanceVehicle })
      const suspendedDriver = await createTransportDriverFixture(request, token, { status: 'suspended' })
      cleanup.push({ path: DRIVERS, id: suspendedDriver })
      const expiredDriver = await createTransportDriverFixture(request, token, { licenseExpiry: isoDate(-5) })
      cleanup.push({ path: DRIVERS, id: expiredDriver })

      const window = { requestedPickupAt: isoInstant(1), requestedDeliveryAt: isoInstant(1.5) }

      const orderOne = await createFreightOrderFixture(request, token, {
        customerId: company, customerSnapshot: snapshot, ...window,
      })
      cleanup.push({ path: ORDERS, id: orderOne.id })
      const orderTwo = await createFreightOrderFixture(request, token, {
        customerId: company, customerSnapshot: snapshot, ...window,
      })
      cleanup.push({ path: ORDERS, id: orderTwo.id })

      expect((await runFreightOrderAction(request, token, orderOne.id, 'confirm')).ok).toBeTruthy()
      expect((await runFreightOrderAction(request, token, orderTwo.id, 'confirm')).ok).toBeTruthy()

      const maintenance = await runFreightOrderAction(request, token, orderOne.id, 'assign', {
        vehicleId: maintenanceVehicle, driverId: availableDriver,
      })
      expect(maintenance.status).toBe(409)

      const suspended = await runFreightOrderAction(request, token, orderOne.id, 'assign', {
        vehicleId: activeVehicle, driverId: suspendedDriver,
      })
      expect(suspended.status).toBe(409)

      const expired = await runFreightOrderAction(request, token, orderOne.id, 'assign', {
        vehicleId: activeVehicle, driverId: expiredDriver,
      })
      expect(expired.status).toBe(409)

      const first = await runFreightOrderAction(request, token, orderOne.id, 'assign', {
        vehicleId: activeVehicle, driverId: availableDriver,
      })
      expect(first.ok, JSON.stringify(first.body)).toBeTruthy()

      const overlap = await runFreightOrderAction(request, token, orderTwo.id, 'assign', {
        vehicleId: activeVehicle, driverId: availableDriver,
      })
      expect(overlap.status).toBe(409)
    } finally {
      for (const entry of cleanup.reverse()) {
        await deleteFreightEntityIfExists(request, token, entry.path, entry.id)
      }
      await deleteFreightEntityIfExists(request, token, COMPANIES, company)
    }
  })
})
