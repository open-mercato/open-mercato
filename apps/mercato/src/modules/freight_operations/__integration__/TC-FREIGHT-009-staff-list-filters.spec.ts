import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCompanyFixture } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  activateFreightContractFixture,
  advanceFreightTripToDelivered,
  createFreightContractFixture,
  createFreightContractRouteFixture,
  createFreightTripFixture,
  deleteFreightEntityIfExists,
  generateFreightAbstractFixture,
  getFreightAbstractFixture,
  runFreightAbstractAction,
  uniqueFreightSuffix,
} from '@open-mercato/core/helpers/integration/freightFixtures'

export const integrationMeta = {
  dependsOnModules: ['freight_operations', 'customers'],
}

const CONTRACTS = '/api/freight_operations/contracts'
const TRIPS = '/api/freight_operations/trips'
const ABSTRACTS = '/api/freight_operations/abstracts'

async function listIds(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  path: string,
  params: Record<string, string>,
): Promise<string[]> {
  const search = new URLSearchParams({ pageSize: '50', ...params })
  const response = await apiRequest(request, 'GET', `${path}?${search.toString()}`, { token })
  const body = await readJsonSafe<{ items?: Array<{ id: string }> }>(response)
  return (body?.items ?? []).map((row) => row.id)
}

/**
 * TC-FREIGHT-009: every filter the staff screens send does something.
 *
 * This module's history includes filters that returned 200 with the full page
 * (a camelCase key the server dropped) and filters that matched nothing for
 * every row — both read as "nothing here yet" on a screen. Each assertion
 * therefore checks the fixture is *found* by its own filter and *absent* under
 * a value only the sibling carries.
 */
test.describe('TC-FREIGHT-009: staff list filters narrow in both directions', () => {
  test('contract, trip and abstract filters select exactly their rows', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueFreightSuffix()
    const customerA = await createCompanyFixture(request, token, `Filter A ${suffix}`)
    const customerB = await createCompanyFixture(request, token, `Filter B ${suffix}`)
    const snapshotA = { id: customerA, kind: 'company' as const, displayName: `Filter A ${suffix}` }
    const snapshotB = { id: customerB, kind: 'company' as const, displayName: `Filter B ${suffix}` }

    let contractA: string | null = null
    let contractB: string | null = null
    let rateLineA: string | null = null
    let rateLineB: string | null = null
    let tripA: string | null = null
    let tripB: string | null = null
    let abstractB: string | null = null

    try {
      contractA = (await createFreightContractFixture(request, token, { customerId: customerA, customerSnapshot: snapshotA, title: `Alpha corridor ${suffix}` })).id
      contractB = (await createFreightContractFixture(request, token, { customerId: customerB, customerSnapshot: snapshotB, title: `Beta corridor ${suffix}` })).id
      rateLineA = await createFreightContractRouteFixture(request, token, contractA, { rateAmount: '450' })
      rateLineB = await createFreightContractRouteFixture(request, token, contractB, { rateAmount: '550' })
      await activateFreightContractFixture(request, token, contractA)
      await activateFreightContractFixture(request, token, contractB)

      // Contract filters: customer narrows to A, the search finds A alone.
      expect(await listIds(request, token, CONTRACTS, { customerId: customerA })).toContain(contractA)
      expect(await listIds(request, token, CONTRACTS, { customerId: customerA })).not.toContain(contractB)
      expect(await listIds(request, token, CONTRACTS, { search: `Alpha corridor ${suffix}` })).toEqual([contractA])

      // Rate lines are scoped to their contract — the screen's child table.
      const linesOfA = await listIds(request, token, '/api/freight_operations/contract-routes', { contractId: contractA })
      expect(linesOfA).toContain(rateLineA)
      expect(linesOfA).not.toContain(rateLineB)

      tripA = await createFreightTripFixture(request, token, { contractId: contractA, contractRouteId: rateLineA })
      tripB = await createFreightTripFixture(request, token, { contractId: contractB, contractRouteId: rateLineB })
      await advanceFreightTripToDelivered(request, token, tripA)

      // Trip filters: billing status and customer both narrow correctly.
      const unbilled = await listIds(request, token, TRIPS, { billingStatus: 'unbilled', contractId: contractB })
      expect(unbilled).toContain(tripB)
      expect(unbilled).not.toContain(tripA)
      const deliveredForA = await listIds(request, token, TRIPS, { executionStatus: 'delivered', customerId: customerA })
      expect(deliveredForA).toContain(tripA)
      expect(deliveredForA).not.toContain(tripB)

      // Abstract filters: generated for B, the status/customer filters find it.
      abstractB = await generateFreightAbstractFixture(request, token, { contractId: contractB })
      expect(await listIds(request, token, ABSTRACTS, { customerId: customerB })).toContain(abstractB)
      expect(await listIds(request, token, ABSTRACTS, { customerId: customerB })).not.toContain(contractA)
      expect(await listIds(request, token, ABSTRACTS, { status: 'draft' })).toContain(abstractB)

      // The abstract detail the screen shows is one fetch of the same list.
      const abstractRow = await getFreightAbstractFixture(request, token, abstractB)
      expect(abstractRow?.status).toBe('draft')
      expect(Number(abstractRow?.trip_count)).toBe(1)
    } finally {
      if (abstractB) await runFreightAbstractAction(request, token, abstractB, 'cancel', { reason: 'teardown' })
      await deleteFreightEntityIfExists(request, token, TRIPS, tripA)
      await deleteFreightEntityIfExists(request, token, TRIPS, tripB)
      await deleteFreightEntityIfExists(request, token, '/api/freight_operations/contract-routes', rateLineA)
      await deleteFreightEntityIfExists(request, token, '/api/freight_operations/contract-routes', rateLineB)
      await deleteFreightEntityIfExists(request, token, CONTRACTS, contractA)
      await deleteFreightEntityIfExists(request, token, CONTRACTS, contractB)
    }
  })
})
