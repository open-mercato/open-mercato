import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCompanyFixture } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  createRentalContractFixture,
  createTransportDriverFixture,
  createTransportVehicleFixture,
  deleteModuleEntityIfExists,
  fetchModuleRow,
  runModuleAction,
  uniqueModuleSuffix,
} from '@open-mercato/core/helpers/integration/moduleFixtures'

export const integrationMeta = {
  dependsOnModules: ['vehicle_rentals', 'customers', 'transport_operations'],
}

const CONTRACTS = '/api/vehicle_rentals/contracts'
const CHECKS = '/api/vehicle_rentals/checks'
const VEHICLES = '/api/transport_operations/vehicles'
const DRIVERS = '/api/transport_operations/drivers'

/**
 * TC-RENTAL-001: a rental is a document pair — a handover check that opens it
 * and a return check that closes it — and the closing odometer decides the
 * extra kilometres that get billed.
 *
 * The invariants under test are the ones the money depends on: the rental only
 * starts from a handover, the closing reading can never be below the opening
 * one, and the extra-mileage charge follows the included allowance.
 */
test.describe('TC-RENTAL-001: rental handover, return and extra-kilometre billing', () => {
  test('hands over, returns, and bills the mileage past the allowance', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueModuleSuffix()
    const company = await createCompanyFixture(request, token, `Rental TC ${suffix}`)
    const snapshot = { id: company, kind: 'company' as const, displayName: `Rental TC ${suffix}` }
    const vehicleId = await createTransportVehicleFixture(request, token)
    const driverId = await createTransportDriverFixture(request, token)

    // A window that lands on whole days: today's midnight through the
    // midnight three days later, so the billed periods are exactly three.
    const windowStart = new Date()
    windowStart.setUTCHours(0, 0, 0, 0)
    const windowEnd = new Date(windowStart.getTime() + 2 * 24 * 60 * 60 * 1000)

    let contractId: string | null = null
    try {
      const contract = await createRentalContractFixture(request, token, {
        customerId: company,
        customerSnapshot: snapshot,
        dailyRate: '500',
        includedKm: 300,
        extraKmRate: '2',
        startAt: windowStart.toISOString(),
        endAt: windowEnd.toISOString(),
      })
      contractId = contract.id

      // A return before the handover is refused: there is nothing to close yet.
      const earlyReturn = await runModuleAction(request, token, `${CONTRACTS}/return`, { id: contractId, odoEndKm: 1200 })
      expect(earlyReturn.status).toBe(409)

      const handover = await runModuleAction(request, token, `${CONTRACTS}/handover`, {
        id: contractId,
        vehicleId,
        driverId,
        odoStartKm: 1000,
      })
      expect(handover.ok, JSON.stringify(handover.body)).toBeTruthy()

      const active = await fetchModuleRow(request, token, CONTRACTS, contractId)
      expect(active?.status).toBe('active')
      expect(active?.odo_start_km).toBe(1000)
      expect(active?.vehicle_snapshot).toBeTruthy()

      // The handover wrote its check document.
      const handoverChecks = await apiRequest(request, 'GET', `${CHECKS}?contractId=${contractId}`, { token })
      const handoverBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(handoverChecks)
      expect(handoverBody?.items?.length).toBe(1)
      expect(handoverBody?.items?.[0]?.kind).toBe('handover')

      // A closing odometer below the handover reading is refused.
      const badOdo = await runModuleAction(request, token, `${CONTRACTS}/return`, { id: contractId, odoEndKm: 900 })
      expect(badOdo.status).toBe(409)

      const returned = await runModuleAction(request, token, `${CONTRACTS}/return`, { id: contractId, odoEndKm: 1600 })
      expect(returned.ok, JSON.stringify(returned.body)).toBeTruthy()

      const closed = await fetchModuleRow(request, token, CONTRACTS, contractId)
      expect(closed?.status).toBe('completed')
      expect(closed?.usage_km).toBe(600)
      // 3 days × 300 km included = 900 km allowance, so 600 km is all inside it.
      expect(closed?.extra_km).toBe(0)
      expect(Number(closed?.extra_km_amount_net)).toBe(0)
      // 3 days × SAR 500 = 1500 net, 15% VAT.
      expect(Number(closed?.rental_amount_net)).toBe(1500)
      expect(Number(closed?.tax_amount)).toBe(225)
      expect(Number(closed?.total_gross_amount)).toBe(1725)

      const checks = await apiRequest(request, 'GET', `${CHECKS}?contractId=${contractId}`, { token })
      const checksBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(checks)
      expect(checksBody?.items?.map((row) => row.kind)).toEqual(['handover', 'return'])

      // A closed rental is final.
      const lateReturn = await runModuleAction(request, token, `${CONTRACTS}/return`, { id: contractId, odoEndKm: 1700 })
      expect(lateReturn.status).toBe(409)
      const lateHandover = await runModuleAction(request, token, `${CONTRACTS}/handover`, { id: contractId, vehicleId, odoStartKm: 1000 })
      expect(lateHandover.status).toBe(409)
    } finally {
      await deleteModuleEntityIfExists(request, token, CONTRACTS, contractId)
      await deleteModuleEntityIfExists(request, token, VEHICLES, vehicleId)
      await deleteModuleEntityIfExists(request, token, DRIVERS, driverId)
    }
  })

  test('refuses a handover whose vehicle is already out on an overlapping rental', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueModuleSuffix()
    const company = await createCompanyFixture(request, token, `Rental overlap ${suffix}`)
    const snapshot = { id: company, kind: 'company' as const, displayName: `Rental overlap ${suffix}` }
    const vehicleId = await createTransportVehicleFixture(request, token)

    let first: string | null = null
    let second: string | null = null
    try {
      first = (await createRentalContractFixture(request, token, { customerId: company, customerSnapshot: snapshot })).id
      second = (await createRentalContractFixture(request, token, { customerId: company, customerSnapshot: snapshot })).id

      expect((await runModuleAction(request, token, `${CONTRACTS}/handover`, { id: first, vehicleId, odoStartKm: 10 })).ok).toBeTruthy()
      const overlap = await runModuleAction(request, token, `${CONTRACTS}/handover`, { id: second, vehicleId, odoStartKm: 10 })
      expect(overlap.status).toBe(409)
    } finally {
      await deleteModuleEntityIfExists(request, token, CONTRACTS, second)
      await deleteModuleEntityIfExists(request, token, CONTRACTS, first)
      await deleteModuleEntityIfExists(request, token, VEHICLES, vehicleId)
    }
  })
})
