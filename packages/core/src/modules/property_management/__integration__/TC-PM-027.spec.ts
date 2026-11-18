import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { stampOf } from './helpers'
import { bookingDay, cleanupBookingSetup, createBooking, createBookingSetup, postBooking, type BookingSetup } from './bookingFixtures'
import { addIsoDays } from './leaseFixtures'
import { readSlots, weekdayOf } from './unavailabilityFixtures'

/**
 * TC-PM-027: Opening hours
 * The building form saves opening hours as a set (weekday 0 = Monday; a missing weekday is closed).
 * Slots follow that weekday's window, a closed day has none, and a booking outside the hours → 409.
 * Narrowing the hours keeps existing bookings and the save lists the ones now outside them.
 */
test.describe('TC-PM-027: opening hours', () => {
  test('slots and bookings follow the weekday window; narrowing keeps and lists bookings outside it', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: BookingSetup | null = null
    try {
      setup = await createBookingSetup(request, token, stamp)
      const [unitId] = setup.unitIds
      const buildingId = setup.buildingId as string
      const day = bookingDay(3)
      const base = { unitId, bookedByPersonId: setup.personId as string, customerCompanyId: setup.companyId }
      const earlyId = await createBooking(request, token, setup, { ...base, startsAt: `${day}T08:00`, endsAt: `${day}T09:00` })

      const invalid = await apiRequest(request, 'PUT', '/api/property_management/buildings', {
        token,
        data: { id: buildingId, openingHoursEnabled: true, openingHours: [{ weekday: weekdayOf(day), opensAt: '14:00', closesAt: '10:00' }] },
      })
      expect(invalid.status(), 'closing before opening is refused').toBeGreaterThanOrEqual(400)
      expect(invalid.status()).toBeLessThan(500)

      const saved = await apiRequest(request, 'PUT', '/api/property_management/buildings', {
        token,
        data: { id: buildingId, openingHoursEnabled: true, openingHours: [{ weekday: weekdayOf(day), opensAt: '10:00', closesAt: '14:00' }] },
      })
      const savedBody = await readJsonSafe<{ ok?: boolean; bookingsOutsideHours?: Array<{ id: string }> }>(saved)
      expect(saved.status(), `PUT buildings → ${JSON.stringify(savedBody)}`).toBe(200)
      expect(savedBody?.bookingsOutsideHours?.map((booking) => booking.id), 'the save lists bookings now outside the hours').toEqual([earlyId])

      const detail = await apiRequest(request, 'GET', `/api/property_management/buildings?id=${buildingId}`, { token })
      const building = (await readJsonSafe<{ items?: Array<{ openingHoursEnabled: boolean; openingHours: unknown[] }> }>(detail))?.items?.[0]
      expect(building).toMatchObject({ openingHoursEnabled: true, openingHours: [{ weekday: weekdayOf(day), opensAt: '10:00', closesAt: '14:00' }] })

      const open = await readSlots(request, token, unitId, day)
      expect(open.openingHours).toEqual([{ start: `${day}T10:00`, end: `${day}T14:00` }])
      expect(open.slots.map((slot) => slot.start)).toEqual([`${day}T10:00`, `${day}T11:00`, `${day}T12:00`, `${day}T13:00`])
      const closed = await readSlots(request, token, unitId, addIsoDays(day, 1))
      expect(closed.openingHours).toEqual([])
      expect(closed.slots).toEqual([])

      const outside = await postBooking(request, token, { ...base, startsAt: `${day}T15:00`, endsAt: `${day}T16:00` })
      expect(outside.status(), 'a booking outside the opening hours is refused').toBe(409)
      expect((await readJsonSafe<{ code?: string }>(outside))?.code).toBe('booking_outside_opening_hours')
      await createBooking(request, token, setup, { ...base, startsAt: `${day}T10:00`, endsAt: `${day}T11:00` })

      const kept = await apiRequest(request, 'GET', `/api/property_management/bookings?id=${earlyId}`, { token })
      expect((await readJsonSafe<{ items?: Array<{ status: string }> }>(kept))?.items?.[0]?.status, 'narrowing the hours keeps the booking').not.toBe('cancelled')

      const off = await apiRequest(request, 'PUT', '/api/property_management/buildings', { token, data: { id: buildingId, openingHoursEnabled: false } })
      expect(off.status()).toBe(200)
      expect((await readSlots(request, token, unitId, addIsoDays(day, 1))).slots, 'without opening hours the whole day is bookable').toHaveLength(24)
    } finally {
      await cleanupBookingSetup(request, token, setup)
    }
  })
})
