import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createSpace, listFloors, listSpaces, stampOf, updateSpace } from './helpers'
import { bookingDay, cleanupBookingSetup, createBooking, createBookingSetup, readBooking, type BookingSetup } from './bookingFixtures'
import { isoDayFromToday } from './leaseFixtures'
import { confirmClosure, endClosures } from './unavailabilityFixtures'

/**
 * TC-PM-028: A move must not carry bookings into a closure
 * A unit with an upcoming booking cannot be moved into a space that is unavailable at the booking's time
 * (409 unit_move_destination_unavailable, listing the booking); the booking stays as it was. Without a
 * booking in the closure, the move is allowed.
 */
test.describe('TC-PM-028: unit move into an unavailable space', () => {
  test('refuses moving a booked unit into a closed space and keeps the booking', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: BookingSetup | null = null
    const closureIds: string[] = []
    try {
      setup = await createBookingSetup(request, token, stamp)
      const [unitId] = setup.unitIds
      const [floor] = await listFloors(request, token, setup.buildingId as string)
      const [whole] = await listSpaces(request, token, floor.id)
      const shrink = await updateSpace(request, token, { id: whole.id, width: 20 })
      expect(shrink.status(), `shrink the default space → ${JSON.stringify(await readJsonSafe(shrink))}`).toBe(200)
      const closedSpaceId = await createSpace(request, token, { floorId: floor.id, name: `Closed wing ${stamp}`, x: 20, y: 0, width: 20, depth: 10 })
      const day = bookingDay(3)
      const bookingId = await createBooking(request, token, setup, {
        unitId,
        startsAt: `${day}T09:00`,
        endsAt: `${day}T10:00`,
        bookedByPersonId: setup.personId as string,
        customerCompanyId: setup.companyId,
      })
      await confirmClosure(request, token, { subjectType: 'space', subjectId: closedSpaceId, startsAt: `${isoDayFromToday(0)}T00:00` }, closureIds)

      const move = await apiRequest(request, 'PUT', '/api/property_management/units', {
        token,
        data: { id: unitId, spaceId: closedSpaceId, x: 25, y: 0 },
      })
      const moveBody = await readJsonSafe<{ code?: string; bookings?: Array<{ id: string }> }>(move)
      expect(move.status(), `PUT units → ${JSON.stringify(moveBody)}`).toBe(409)
      expect(moveBody?.code).toBe('unit_move_destination_unavailable')
      expect(moveBody?.bookings?.map((booking) => booking.id)).toEqual([bookingId])
      expect((await readBooking(request, token, bookingId))?.status, 'the booking stays held').not.toBe('cancelled')

      const cancel = await apiRequest(request, 'POST', `/api/property_management/bookings/${bookingId}/cancel`, { token })
      expect(cancel.status()).toBe(200)
      const moved = await apiRequest(request, 'PUT', '/api/property_management/units', { token, data: { id: unitId, spaceId: closedSpaceId, x: 25, y: 0 } })
      expect(moved.status(), `PUT units after cancelling → ${JSON.stringify(await readJsonSafe(moved))}`).toBe(200)
    } finally {
      await endClosures(request, token, closureIds)
      await cleanupBookingSetup(request, token, setup)
    }
  })
})
