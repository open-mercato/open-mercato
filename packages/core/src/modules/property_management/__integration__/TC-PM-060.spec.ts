import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { stampOf } from './helpers'
import { bookingDay, cleanupBookingSetup, createBookingSetup, postBooking, type BookingSetup } from './bookingFixtures'

type SlotsBody = { slots?: Array<{ start: string; end: string; state: 'free' | 'booked' }> }

/**
 * TC-PM-060: booking after the building is archived
 * Once a building is archived it takes no new bookings: `POST bookings` for one of its units answers
 * 409 location_unavailable, no booking is held, and the unit's slots for the day offer nothing free.
 */
test.describe('TC-PM-060: booking an archived building', () => {
  test('refuses a booking in an archived building with 409 location_unavailable', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: BookingSetup | null = null
    try {
      setup = await createBookingSetup(request, token, stamp)
      const [unitId] = setup.unitIds
      const day = bookingDay(3)

      const archive = await apiRequest(request, 'POST', `/api/property_management/buildings/${setup.buildingId}/archive`, { token })
      expect(archive.status(), `POST buildings/{id}/archive → ${JSON.stringify(await readJsonSafe(archive))}`).toBe(200)

      const response = await postBooking(request, token, {
        unitId,
        startsAt: `${day}T09:00`,
        endsAt: `${day}T11:00`,
        bookedByPersonId: setup.personId as string,
        customerCompanyId: setup.companyId,
      })
      const body = await readJsonSafe<{ id?: string; code?: string }>(response)
      if (typeof body?.id === 'string' && body.id) setup.bookingIds.push(body.id)
      expect(response.status(), `POST bookings → ${JSON.stringify(body)}`).toBe(409)
      expect(body?.code).toBe('location_unavailable')

      const listed = await readJsonSafe<{ items?: Array<{ id: string }> }>(
        await apiRequest(request, 'GET', `/api/property_management/bookings?unitId=${encodeURIComponent(unitId)}`, { token }),
      )
      expect(listed?.items ?? [], 'no booking is held in an archived building').toHaveLength(0)

      const slots = await apiRequest(request, 'GET', `/api/property_management/units/${unitId}/slots?date=${day}`, { token })
      expect(slots.status()).toBe(200)
      const slotsBody = await readJsonSafe<SlotsBody>(slots)
      expect((slotsBody?.slots ?? []).filter((slot) => slot.state === 'free'), 'an archived building offers no free slots').toHaveLength(0)
    } finally {
      await cleanupBookingSetup(request, token, setup)
    }
  })
})
