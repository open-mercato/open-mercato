import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { listFloors, stampOf } from './helpers'
import { cleanupLeaseSetup, createLease, createLeaseSetup, isoDayFromToday, readSettings, saveSettings, type LeaseSetup } from './leaseFixtures'
import { createManagers, deleteManagers, type ManagerFixture } from './staffFixtures'

type StatusUnit = {
  id: string
  status: string
  leaseEnding: boolean
  proposed: boolean
  lease: { id: string; reference: string; endsOn: string; daysLeft: number; companyName: string | null } | null
}

type LayoutBody = { date?: string; leaseEndingThresholdDays?: number; units: StatusUnit[]; unavailableAreas?: unknown[] }

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/**
 * TC-PM-030: floor plan status projection — leases and building access
 * `GET floors/{id}/layout?date=` returns every unit's status on the date: a unit whose lease covers the
 * date is `occupied` with the lease reference, company and days left; a lease ending within the
 * organization's `leaseEndingThresholdDays` carries `leaseEnding: true` (a 12-month lease does not); a
 * unit without a lease is `available`. The threshold is echoed. A manager of another building gets 404,
 * the assigned manager gets the projection, and an invalid date is 400.
 */
test.describe('TC-PM-030: floor plan status — leases', () => {
  test('marks a lease ending within the threshold and scopes the projection to assigned managers', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let managers: ManagerFixture | null = null
    let setup: LeaseSetup | null = null
    try {
      managers = await createManagers(request, adminToken, stamp, 2)
      const [assigned, outsider] = managers.users
      setup = await createLeaseSetup(request, adminToken, stamp, { units: 3, managerUserIds: [assigned.id] })
      const current = await readSettings(request, adminToken)
      const saved = await saveSettings(request, adminToken, { ...current, leaseEndingThresholdDays: 60 })
      expect(saved.status(), 'PUT settings with a 60-day threshold').toBe(200)
      const [endingUnit, longUnit, freeUnit] = setup.unitIds
      const [companyId] = setup.companyIds
      const date = isoDayFromToday(1)
      const ending = await createLease(request, adminToken, setup, { unitId: endingUnit, customerCompanyId: companyId, startsOn: date, termMonths: 1 })
      const long = await createLease(request, adminToken, setup, { unitId: longUnit, customerCompanyId: companyId, startsOn: date, termMonths: 12 })
      const [floor] = await listFloors(request, adminToken, setup.buildingId as string)

      const response = await apiRequest(request, 'GET', `/api/property_management/floors/${floor.id}/layout?date=${date}`, { token: assigned.token })
      const body = await readJsonSafe<LayoutBody>(response)
      expect(response.status(), `layout?date → ${JSON.stringify(body)}`).toBe(200)
      expect(body?.date).toBe(date)
      expect(body?.leaseEndingThresholdDays).toBe(60)
      expect(Array.isArray(body?.unavailableAreas)).toBe(true)
      const byId = new Map((body?.units ?? []).map((unit) => [unit.id, unit]))

      const endingRow = byId.get(endingUnit)
      expect(endingRow?.status).toBe('occupied')
      expect(endingRow?.lease?.id).toBe(ending.id)
      expect(endingRow?.lease?.companyName).toBeTruthy()
      expect(endingRow?.leaseEnding, 'a one-month lease ends within 60 days').toBe(true)
      expect(endingRow?.lease?.daysLeft).toBe(daysBetween(date, endingRow?.lease?.endsOn as string))
      expect(endingRow?.lease?.daysLeft).toBeGreaterThan(0)
      expect(endingRow?.lease?.daysLeft).toBeLessThanOrEqual(60)

      const longRow = byId.get(longUnit)
      expect(longRow?.status).toBe('occupied')
      expect(longRow?.lease?.id).toBe(long.id)
      expect(longRow?.leaseEnding).toBe(false)

      expect(byId.get(freeUnit)).toMatchObject({ status: 'available', lease: null, leaseEnding: false, proposed: false })

      const plain = await readJsonSafe<LayoutBody>(await apiRequest(request, 'GET', `/api/property_management/floors/${floor.id}/layout`, { token: adminToken }))
      expect(plain?.date, 'without ?date= the setup payload has no status projection').toBeUndefined()
      expect(plain?.units.find((unit) => unit.id === endingUnit)?.status).toBeUndefined()

      const foreign = await apiRequest(request, 'GET', `/api/property_management/floors/${floor.id}/layout?date=${date}`, { token: outsider.token })
      expect(foreign.status(), "another manager's floor is not found").toBe(404)

      const invalid = await apiRequest(request, 'GET', `/api/property_management/floors/${floor.id}/layout?date=2026-02-30`, { token: adminToken })
      expect(invalid.status()).toBe(400)
    } finally {
      await cleanupLeaseSetup(request, adminToken, setup)
      await deleteManagers(request, adminToken, managers)
    }
  })
})
