import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
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
  getFreightAbstractLinesFixture,
  getFreightTripFixture,
  isoDate,
  runFreightAbstractAction,
  uniqueFreightSuffix,
} from '@open-mercato/core/helpers/integration/freightFixtures'

export const integrationMeta = {
  dependsOnModules: ['freight_operations', 'customers', 'transport_operations'],
}

const COMPANIES = '/api/customers/companies'
const CONTRACTS = '/api/freight_operations/contracts'
const CONTRACT_ROUTES = '/api/freight_operations/contract-routes'
const TRIPS = '/api/freight_operations/trips'

/**
 * TC-FREIGHT-006: an abstract is generated from what was actually executed, and
 * a customer's dispute settles line by line.
 *
 * The two invariants under test are the ones the money depends on: a trip sits
 * on at most one live abstract (generation parks it, a resolution that un-bills
 * it releases it), and the abstract totals are always the sum of the lines that
 * are still billable.
 */
test.describe('TC-FREIGHT-006: trip abstract lifecycle and dispute resolution', () => {
  test('generates from delivered trips, then settles a disputed line', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = uniqueFreightSuffix()
    const company = await createCompanyFixture(request, token, `Abstract TC ${suffix}`)
    const snapshot = { id: company, kind: 'company' as const, displayName: `Abstract TC ${suffix}` }

    let contract: string | null = null
    let rateLine: string | null = null
    const trips: string[] = []
    let firstAbstract: string | null = null
    let secondAbstract: string | null = null

    try {
      contract = (await createFreightContractFixture(request, token, {
        customerId: company,
        customerSnapshot: snapshot,
        requiresCustomerApproval: true,
        title: `Abstract TC ${suffix}`,
      })).id
      rateLine = await createFreightContractRouteFixture(request, token, contract, { rateAmount: '450' })
      await activateFreightContractFixture(request, token, contract)

      for (let index = 0; index < 2; index += 1) {
        const trip = await createFreightTripFixture(request, token, { contractId: contract, contractRouteId: rateLine })
        await advanceFreightTripToDelivered(request, token, trip)
        trips.push(trip)
      }

      firstAbstract = await generateFreightAbstractFixture(request, token, {
        contractId: contract,
        periodFrom: isoDate(-7),
        periodTo: isoDate(1),
      })

      const draft = await getFreightAbstractFixture(request, token, firstAbstract)
      expect(draft?.status).toBe('draft')
      expect(draft?.trip_count).toBe(2)
      expect(draft?.requires_customer_approval).toBe(true)
      // 2 × SAR 450 net, 15% VAT to the halala.
      expect(Number(draft?.subtotal_net_amount)).toBe(900)
      expect(Number(draft?.tax_total_amount)).toBe(135)
      expect(Number(draft?.grand_total_gross_amount)).toBe(1035)

      // Generation parks both trips, so the same trip cannot be billed twice.
      for (const trip of trips) {
        expect((await getFreightTripFixture(request, token, trip))?.billing_status).toBe('in_abstract')
      }
      const duplicate = await apiRequest(request, 'POST', '/api/freight_operations/abstracts/generate', {
        token,
        data: { contractId: contract, periodFrom: isoDate(-7), periodTo: isoDate(1) },
        retryTransport: false,
      })
      expect(duplicate.status()).toBe(409)

      const lines = await getFreightAbstractLinesFixture(request, token, firstAbstract)
      expect(lines.length).toBe(2)
      const [keptLine, disputedLine] = lines
      const keptTripId = String(keptLine.trip_id)
      const disputedTripId = String(disputedLine.trip_id)

      // A response before the abstract was submitted is refused.
      const earlyRespond = await runFreightAbstractAction(request, token, firstAbstract, 'respond', {
        disputedLines: [{ lineId: disputedLine.id, note: 'Too early' }],
      })
      expect(earlyRespond.status).toBe(409)

      const submitted = await runFreightAbstractAction(request, token, firstAbstract, 'submit')
      expect(submitted.ok, JSON.stringify(submitted.body)).toBeTruthy()
      expect((await getFreightAbstractFixture(request, token, firstAbstract))?.status).toBe('submitted')

      const responded = await runFreightAbstractAction(request, token, firstAbstract, 'respond', {
        acceptedLineIds: [keptLine.id],
        disputedLines: [{ lineId: disputedLine.id, note: 'This trip never ran.' }],
      })
      expect(responded.ok, JSON.stringify(responded.body)).toBeTruthy()

      const disputed = await getFreightAbstractFixture(request, token, firstAbstract)
      expect(disputed?.status).toBe('disputed')
      const disputedRows = await getFreightAbstractLinesFixture(request, token, firstAbstract)
      const disputedRow = disputedRows.find((row) => row.id === disputedLine.id)
      expect(disputedRow?.dispute_status).toBe('disputed')
      expect(disputedRow?.dispute_origin).toBe('staff')

      // Settling the only dispute approves the abstract and un-bills that line.
      const resolved = await runFreightAbstractAction(request, token, firstAbstract, 'resolve', {
        resolutions: [
          {
            lineId: disputedLine.id,
            resolution: 'accepted_as_disputed',
            resolutionNote: 'Customer was right — the trip was cancelled at the gate.',
          },
        ],
      })
      expect(resolved.ok, JSON.stringify(resolved.body)).toBeTruthy()

      const settled = await getFreightAbstractFixture(request, token, firstAbstract)
      expect(settled?.status).toBe('approved')
      expect(settled?.trip_count).toBe(1)
      expect(Number(settled?.subtotal_net_amount)).toBe(450)
      expect(Number(settled?.grand_total_gross_amount)).toBe(517.5)

      const releasedRows = await getFreightAbstractLinesFixture(request, token, firstAbstract)
      const releasedRow = releasedRows.find((row) => row.id === disputedLine.id)
      expect(releasedRow?.is_billable).toBe(false)
      expect(releasedRow?.resolution).toBe('accepted_as_disputed')

      // The un-billed trip is free again, and only that trip is.
      expect((await getFreightTripFixture(request, token, disputedTripId))?.billing_status).toBe('unbilled')
      expect((await getFreightTripFixture(request, token, keptTripId))?.billing_status).toBe('in_abstract')

      secondAbstract = await generateFreightAbstractFixture(request, token, {
        contractId: contract,
        periodFrom: isoDate(-7),
        periodTo: isoDate(1),
      })
      const second = await getFreightAbstractFixture(request, token, secondAbstract)
      expect(second?.trip_count).toBe(1)
      expect(Number(second?.subtotal_net_amount)).toBe(450)

      // An approved abstract takes no further lifecycle verbs.
      const lateSubmit = await runFreightAbstractAction(request, token, firstAbstract, 'submit')
      expect(lateSubmit.status).toBe(409)
      const lateResolve = await runFreightAbstractAction(request, token, firstAbstract, 'resolve', {
        resolutions: [{ lineId: disputedLine.id, resolution: 'rejected_dispute', resolutionNote: 'Too late' }],
      })
      expect(lateResolve.status).toBe(409)
    } finally {
      // Cancelling releases the abstract's trips so the trips can be deleted.
      if (secondAbstract) await runFreightAbstractAction(request, token, secondAbstract, 'cancel', { reason: 'teardown' })
      if (firstAbstract) await runFreightAbstractAction(request, token, firstAbstract, 'cancel', { reason: 'teardown' })
      for (const trip of trips) {
        await deleteFreightEntityIfExists(request, token, TRIPS, trip)
      }
      await deleteFreightEntityIfExists(request, token, CONTRACT_ROUTES, rateLine)
      await deleteFreightEntityIfExists(request, token, CONTRACTS, contract)
      await deleteFreightEntityIfExists(request, token, COMPANIES, company)
    }
  })
})
