import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { listFloors, listSpaces, stampOf } from './helpers'
import { addIsoDays } from './leaseFixtures'
import { bookingDay, cleanupBookingSetup, createBooking, createBookingSetup, type BookingSetup } from './bookingFixtures'
import { confirmClosure, endClosures } from './unavailabilityFixtures'

type StatusUnit = {
  id: string
  status: string
  hasBlockers: boolean
  bookings: Array<{ id: string; startsAt: string; endsAt: string; personId: string; personName: string | null }>
  unavailable: { source: string; reasonText: string | null; from: string | null; until: string | null } | null
}

type LayoutBody = { units: StatusUnit[]; unavailableAreas: Array<{ subjectType: string; subjectId: string; reasonText: string | null }> }

/**
 * TC-PM-031: floor plan status projection — bookings and unavailability
 * On a day with a booking, the bookable unit is `booked` and lists the booking (times and the booking
 * person); a bookable unit without bookings is `free`; a unit closed that day is `unavailable` with the
 * reason and the end of the closure. A later closure of the space makes every unit `unavailable` and lists
 * the space in `unavailableAreas` (the hatched area of the drawing); the day before it is not affected.
 * `hasBlockers` is set only for the unit with an upcoming booking.
 */
test.describe('TC-PM-031: floor plan status — bookings and unavailability', () => {
  test('projects booked, free and unavailable units and the unavailable areas of the floor', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: BookingSetup | null = null
    const closureIds: string[] = []
    try {
      setup = await createBookingSetup(request, token, stamp, { units: 3 })
      const [bookedUnit, closedUnit, freeUnit] = setup.unitIds
      const day = bookingDay(2)
      const bookingId = await createBooking(request, token, setup, {
        unitId: bookedUnit,
        startsAt: `${day}T10:00`,
        endsAt: `${day}T12:00`,
        bookedByPersonId: setup.personId as string,
        customerCompanyId: setup.companyId,
      })
      await confirmClosure(
        request,
        token,
        { subjectType: 'unit', subjectId: closedUnit, startsAt: `${day}T00:00`, endsAt: `${addIsoDays(day, 3)}T00:00`, reasonText: 'QA paint' },
        closureIds,
      )
      const [floor] = await listFloors(request, token, setup.buildingId as string)

      const response = await apiRequest(request, 'GET', `/api/property_management/floors/${floor.id}/layout?date=${day}`, { token })
      const body = await readJsonSafe<LayoutBody>(response)
      expect(response.status(), `layout?date → ${JSON.stringify(body)}`).toBe(200)
      const byId = new Map((body?.units ?? []).map((unit) => [unit.id, unit]))

      const booked = byId.get(bookedUnit)
      expect(booked?.status).toBe('booked')
      expect(booked?.bookings).toHaveLength(1)
      expect(booked?.bookings[0]).toMatchObject({
        id: bookingId,
        startsAt: `${day}T10:00`,
        endsAt: `${day}T12:00`,
        personId: setup.personId,
        personName: `Marta Booker ${stamp}`,
      })

      expect(byId.get(freeUnit)).toMatchObject({ status: 'free', bookings: [], unavailable: null })

      expect(booked?.hasBlockers, 'an upcoming booking blocks the unit').toBe(true)
      expect(byId.get(freeUnit)?.hasBlockers, 'a unit without bookings has no blockers').toBe(false)

      const closed = byId.get(closedUnit)
      expect(closed?.status).toBe('unavailable')
      expect(closed?.unavailable).toMatchObject({ source: 'unit', reasonText: 'QA paint', until: `${addIsoDays(day, 3)}T00:00` })
      expect(body?.unavailableAreas ?? []).toEqual([])

      const [space] = await listSpaces(request, token, floor.id)
      const later = addIsoDays(day, 5)
      await confirmClosure(
        request,
        token,
        { subjectType: 'space', subjectId: space.id, startsAt: `${later}T00:00`, endsAt: `${addIsoDays(later, 1)}T00:00`, reasonText: 'QA floor works' },
        closureIds,
      )
      const laterBody = await readJsonSafe<LayoutBody>(
        await apiRequest(request, 'GET', `/api/property_management/floors/${floor.id}/layout?date=${later}`, { token }),
      )
      expect((laterBody?.units ?? []).map((unit) => unit.status)).toEqual(['unavailable', 'unavailable', 'unavailable'])
      expect(laterBody?.unavailableAreas).toEqual([expect.objectContaining({ subjectType: 'space', subjectId: space.id, reasonText: 'QA floor works' })])

      const dayBefore = await readJsonSafe<LayoutBody>(
        await apiRequest(request, 'GET', `/api/property_management/floors/${floor.id}/layout?date=${addIsoDays(later, -1)}`, { token }),
      )
      expect(dayBefore?.unavailableAreas).toEqual([])
      expect(dayBefore?.units.find((unit) => unit.id === freeUnit)?.status).toBe('free')
    } finally {
      await endClosures(request, token, closureIds)
      await cleanupBookingSetup(request, token, setup)
    }
  })
})
