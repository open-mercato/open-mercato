import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { stampOf } from './helpers'
import { cleanupLeaseSetup, createLease, createLeaseSetup, isoDayFromToday, postLease, type LeaseSetup } from './leaseFixtures'
import { confirmClosure, endClosures, previewClosure } from './unavailabilityFixtures'

type LeaseListItem = { id: string; unitUnavailable: boolean; unitUnavailableFrom: string | null; unitUnavailableUntil: string | null }

/**
 * TC-PM-026: Unavailability flags leases, never ends them
 * Closing a leased unit lists the lease in the dry run and flags it "Unit unavailable" on the Leases list
 * (filter `unitUnavailable=true`), with the period's end; leases of other units are not flagged and the
 * lease keeps its status. A new lease on a unit that is unavailable during the term → 422 unit_unavailable,
 * and the unit picker leaves that unit out.
 */
test.describe('TC-PM-026: unavailable units and leases', () => {
  test('flags the lease of a closed unit and refuses new leases on an unavailable unit', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: LeaseSetup | null = null
    const closureIds: string[] = []
    try {
      setup = await createLeaseSetup(request, token, stamp, { units: 3 })
      const [leasedUnit, otherUnit, freeUnit] = setup.unitIds
      const [companyId] = setup.companyIds
      const startsOn = isoDayFromToday(1)
      const flagged = await createLease(request, token, setup, { unitId: leasedUnit, customerCompanyId: companyId, startsOn, termMonths: 12 })
      const untouched = await createLease(request, token, setup, { unitId: otherUnit, customerCompanyId: companyId, startsOn, termMonths: 12 })

      const closure = { subjectType: 'unit' as const, subjectId: leasedUnit, startsAt: `${isoDayFromToday(5)}T00:00`, endsAt: `${isoDayFromToday(10)}T00:00` }
      const preview = await previewClosure(request, token, closure)
      expect(preview.leasesToFlag.map((lease) => lease.id)).toEqual([flagged.id])
      expect(preview.bookingCount).toBe(0)
      const confirmed = await confirmClosure(request, token, closure, closureIds)
      expect(confirmed.flaggedLeases).toBe(1)

      const list = await apiRequest(
        request,
        'GET',
        `/api/property_management/leases?buildingId=${setup.buildingId}&unitUnavailable=true&pageSize=100`,
        { token },
      )
      expect(list.status()).toBe(200)
      const items = (await readJsonSafe<{ items?: LeaseListItem[] }>(list))?.items ?? []
      expect(items.map((item) => item.id)).toEqual([flagged.id])
      expect(items[0]).toMatchObject({ unitUnavailable: true, unitUnavailableUntil: `${isoDayFromToday(10)}T00:00` })

      const all = await apiRequest(request, 'GET', `/api/property_management/leases?buildingId=${setup.buildingId}&pageSize=100`, { token })
      const allItems = (await readJsonSafe<{ items?: Array<LeaseListItem & { status: string }> }>(all))?.items ?? []
      expect(allItems.find((item) => item.id === untouched.id)?.unitUnavailable).toBe(false)
      expect(allItems.find((item) => item.id === flagged.id)?.status, 'the lease is flagged, not ended').not.toBe('ended')

      await confirmClosure(request, token, { subjectType: 'unit', subjectId: freeUnit, startsAt: `${isoDayFromToday(30)}T00:00` }, closureIds)
      const refused = await postLease(request, token, { unitId: freeUnit, customerCompanyId: companyId, startsOn, termMonths: 12 })
      expect(refused.status(), 'a unit unavailable during the term takes no new lease').toBe(422)
      expect((await readJsonSafe<{ code?: string }>(refused))?.code).toBe('unit_unavailable')

      const units = await apiRequest(
        request,
        'GET',
        `/api/property_management/leases/available-units?buildingId=${setup.buildingId}&startsOn=${startsOn}&termMonths=12`,
        { token },
      )
      const unitIds = ((await readJsonSafe<{ items?: Array<{ id: string }> }>(units))?.items ?? []).map((item) => item.id)
      expect(unitIds).not.toContain(freeUnit)
    } finally {
      await endClosures(request, token, closureIds)
      await cleanupLeaseSetup(request, token, setup)
    }
  })
})
