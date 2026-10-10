import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  createFreightOrderFixture,
  createTransportDriverFixture,
  createTransportVehicleFixture,
  deleteFreightEntityIfExists,
  getFreightOrderFixture,
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
 * TC-FREIGHT-002: the spot-order lifecycle moves one step at a time, and every
 * illegal transition is refused with a 409 instead of being silently applied.
 */
test.describe('TC-FREIGHT-002: freight order execution lifecycle', () => {
  test('the happy path advances through every state; illegal transitions refuse', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueFreightSuffix()
    const company = await createCompanyFixture(request, token, `Lifecycle TC ${suffix}`)
    const snapshot = { id: company, kind: 'company' as const, displayName: `Lifecycle TC ${suffix}` }

    let order: string | null = null
    let vehicle: string | null = null
    let driver: string | null = null

    try {
      vehicle = await createTransportVehicleFixture(request, token)
      driver = await createTransportDriverFixture(request, token)
      const created = await createFreightOrderFixture(request, token, {
        customerId: company,
        customerSnapshot: snapshot,
        agreedAmountNet: '1260',
        adjustmentAmountNet: '-10',
        requestedPickupAt: isoInstant(1),
        requestedDeliveryAt: isoInstant(1.5),
      })
      order = created.id

      const draft = await getFreightOrderFixture(request, token, order)
      expect(draft?.status).toBe('draft')

      // Illegal from draft.
      const illegalDispatch = await runFreightOrderAction(request, token, order, 'dispatch')
      expect(illegalDispatch.status).toBe(409)
      const illegalAssign = await runFreightOrderAction(request, token, order, 'assign', { vehicleId: vehicle, driverId: driver })
      expect(illegalAssign.status).toBe(409)
      const illegalInvoice = await runFreightOrderAction(request, token, order, 'invoice')
      expect(illegalInvoice.status).toBe(409)

      const confirmed = await runFreightOrderAction(request, token, order, 'confirm')
      expect(confirmed.ok, JSON.stringify(confirmed.body)).toBeTruthy()
      expect((await getFreightOrderFixture(request, token, order))?.status).toBe('confirmed')

      const assigned = await runFreightOrderAction(request, token, order, 'assign', { vehicleId: vehicle, driverId: driver })
      expect(assigned.ok, JSON.stringify(assigned.body)).toBeTruthy()
      const assignedRow = await getFreightOrderFixture(request, token, order)
      expect(assignedRow?.status).toBe('assigned')
      expect(assignedRow?.vehicle_id).toBe(vehicle)
      expect((assignedRow?.vehicle_snapshot as Record<string, unknown> | null | undefined)?.plateNumber).toBeTruthy()

      // Illegal: deliver before dispatch.
      const illegalDeliver = await runFreightOrderAction(request, token, order, 'deliver', { podReference: 'POD-early' })
      expect(illegalDeliver.status).toBe(409)

      const dispatched = await runFreightOrderAction(request, token, order, 'dispatch')
      expect(dispatched.ok, JSON.stringify(dispatched.body)).toBeTruthy()
      expect((await getFreightOrderFixture(request, token, order))?.status).toBe('in_transit')

      const delivered = await runFreightOrderAction(request, token, order, 'deliver', { podReference: `POD-${suffix}` })
      expect(delivered.ok, JSON.stringify(delivered.body)).toBeTruthy()
      const deliveredRow = await getFreightOrderFixture(request, token, order)
      expect(deliveredRow?.status).toBe('delivered')
      expect(deliveredRow?.pod_reference).toBe(`POD-${suffix}`)

      const completed = await runFreightOrderAction(request, token, order, 'complete')
      expect(completed.ok, JSON.stringify(completed.body)).toBeTruthy()
      expect((await getFreightOrderFixture(request, token, order))?.status).toBe('completed')
    } finally {
      await deleteFreightEntityIfExists(request, token, ORDERS, order)
      await deleteFreightEntityIfExists(request, token, DRIVERS, driver)
      await deleteFreightEntityIfExists(request, token, VEHICLES, vehicle)
      await deleteFreightEntityIfExists(request, token, COMPANIES, company)
    }
  })
})
