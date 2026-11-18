import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { listFloors, stampOf } from './helpers'
import {
  bookingDay,
  cleanupBookingSetup,
  createBooking,
  createBookingSetup,
  isConfirmed,
  postBooking,
  readBooking,
  settleBooking,
  type BookingSetup,
} from './bookingFixtures'
import { addIsoDays, drainSalesOperations, isoDayFromToday, readField, readSalesDocument } from './leaseFixtures'
import { confirmClosure, endClosure, endClosures, listClosures, postClosure, previewClosure, readSlots } from './unavailabilityFixtures'

/**
 * TC-PM-025: Closing a floor
 * Making a floor unavailable from today previews the bookings it cancels (dry run with a preview token),
 * refuses a confirm whose preview went stale (409 preview_stale), then cancels the floor's bookings with
 * reason `unavailability` and moves their orders to the cancelled status. While it is closed, slots are
 * empty and new bookings are refused (409 unit_unavailable); ending it allows new bookings again.
 * A unit closed for part of a day loses only the slots inside the closure.
 */
test.describe('TC-PM-025: closing a floor', () => {
  test('previews, refuses a stale preview, cancels bookings and blocks new ones until ended', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: BookingSetup | null = null
    const closureIds: string[] = []
    try {
      setup = await createBookingSetup(request, token, stamp)
      const [unitId] = setup.unitIds
      const [floor] = await listFloors(request, token, setup.buildingId as string)
      const day = bookingDay(3)
      const base = { unitId, bookedByPersonId: setup.personId as string, customerCompanyId: setup.companyId }
      const firstId = await createBooking(request, token, setup, { ...base, startsAt: `${day}T09:00`, endsAt: `${day}T10:00` })

      const before = await readSlots(request, token, unitId, day)
      expect(before.slots).toHaveLength(24)
      expect(before.slots.find((slot) => slot.start === `${day}T09:00`)?.state).toBe('booked')

      const closure = { subjectType: 'floor' as const, subjectId: floor.id, startsAt: `${isoDayFromToday(0)}T00:00`, endsAt: `${addIsoDays(day, 1)}T00:00` }
      const preview = await previewClosure(request, token, closure)
      expect(preview.unitCount).toBe(1)
      expect(preview.bookingsToCancel.map((booking) => booking.id)).toEqual([firstId])

      const secondId = await createBooking(request, token, setup, { ...base, startsAt: `${day}T11:00`, endsAt: `${day}T12:00` })
      const stale = await postClosure(request, token, { ...closure, previewToken: preview.previewToken }, false)
      expect(stale.status(), 'a booking made after the preview makes it stale').toBe(409)
      expect((await readJsonSafe<{ code?: string }>(stale))?.code).toBe('preview_stale')
      const missing = await postClosure(request, token, closure, false)
      expect(missing.status(), 'confirm needs a preview token').toBe(422)

      const confirmed = await confirmClosure(request, token, closure, closureIds)
      expect(confirmed.cancelledBookings).toBe(2)
      for (const bookingId of [firstId, secondId]) {
        expect(await readBooking(request, token, bookingId)).toMatchObject({ status: 'cancelled', cancelReason: 'unavailability' })
      }
      const [row] = await listClosures(request, token, setup.buildingId as string)
      expect(row).toMatchObject({ id: confirmed.id, subjectType: 'floor', inEffect: true, cancelledBookingCount: 2, applyStatus: 'applied' })

      const blocked = await postBooking(request, token, { ...base, startsAt: `${day}T14:00`, endsAt: `${day}T15:00` })
      expect(blocked.status(), 'no new bookings while the floor is closed').toBe(409)
      expect((await readJsonSafe<{ code?: string }>(blocked))?.code).toBe('unit_unavailable')
      expect((await readSlots(request, token, unitId, day)).slots, 'a closed day has no slots').toEqual([])
      expect((await readSlots(request, token, unitId, addIsoDays(day, 1))).slots).toHaveLength(24)

      const ended = await endClosure(request, token, confirmed.id)
      expect(ended.status(), `end → ${JSON.stringify(await readJsonSafe(ended))}`).toBe(200)
      expect((await endClosure(request, token, confirmed.id)).status(), 'ending twice is refused').toBe(409)
      await createBooking(request, token, setup, { ...base, startsAt: `${day}T14:00`, endsAt: `${day}T15:00` })
    } finally {
      await endClosures(request, token, closureIds)
      await cleanupBookingSetup(request, token, setup)
    }
  })

  test('moves the order of a cancelled booking to the cancelled status', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: BookingSetup | null = null
    const closureIds: string[] = []
    try {
      setup = await createBookingSetup(request, token, stamp)
      const [unitId] = setup.unitIds
      const [floor] = await listFloors(request, token, setup.buildingId as string)
      const day = bookingDay(4)
      const bookingId = await createBooking(request, token, setup, {
        unitId,
        startsAt: `${day}T09:00`,
        endsAt: `${day}T10:00`,
        bookedByPersonId: setup.personId as string,
        customerCompanyId: setup.companyId,
      })
      const confirmed = await settleBooking(request, token, bookingId, isConfirmed, 'the booking confirmation')
      await confirmClosure(request, token, { subjectType: 'floor', subjectId: floor.id, startsAt: `${isoDayFromToday(0)}T00:00` }, closureIds)
      await drainSalesOperations()
      let row = await readBooking(request, token, bookingId)
      for (let attempt = 0; attempt < 20 && !row?.salesOrderCancelled; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 500))
        row = await readBooking(request, token, bookingId)
      }
      expect(row).toMatchObject({ status: 'cancelled', cancelReason: 'unavailability', salesOrderCancelled: true })
      const order = await readSalesDocument(request, token, 'orders', confirmed.salesOrderId as string)
      expect(order, 'the booking order is never deleted').not.toBeNull()
      expect(readField(order, 'statusEntryId', 'status_entry_id')).toBe(setup.cancelledStatusEntryId)
    } finally {
      await endClosures(request, token, closureIds)
      await cleanupBookingSetup(request, token, setup)
    }
  })

  test('slots leave out the hours a unit is closed for and come back once the closure ends', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: BookingSetup | null = null
    const closureIds: string[] = []
    try {
      setup = await createBookingSetup(request, token, stamp)
      const [unitId] = setup.unitIds
      const day = bookingDay(5)
      const closedHours = [`${day}T10:00`, `${day}T11:00`, `${day}T12:00`]
      expect((await readSlots(request, token, unitId, day)).slots).toHaveLength(24)

      await confirmClosure(request, token, { subjectType: 'unit', subjectId: unitId, startsAt: `${day}T10:00`, endsAt: `${day}T13:00` }, closureIds)
      const starts = (await readSlots(request, token, unitId, day)).slots.map((slot) => slot.start)
      expect(starts, 'the closed hours are no slots').toHaveLength(21)
      for (const start of closedHours) expect(starts, `${start} is closed`).not.toContain(start)
      expect(starts).toEqual(expect.arrayContaining([`${day}T09:00`, `${day}T13:00`]))

      const blocked = await postBooking(request, token, {
        unitId,
        startsAt: `${day}T11:00`,
        endsAt: `${day}T12:00`,
        bookedByPersonId: setup.personId as string,
        customerCompanyId: setup.companyId,
      })
      expect(blocked.status(), 'a booking inside the closure is refused').toBe(409)
      expect((await readJsonSafe<{ code?: string }>(blocked))?.code).toBe('unit_unavailable')

      const ended = await endClosure(request, token, closureIds[0])
      expect(ended.status(), `end → ${JSON.stringify(await readJsonSafe(ended))}`).toBe(200)
      expect((await readSlots(request, token, unitId, day)).slots, 'an ended closure frees its hours').toHaveLength(24)
    } finally {
      await endClosures(request, token, closureIds)
      await cleanupBookingSetup(request, token, setup)
    }
  })
})
