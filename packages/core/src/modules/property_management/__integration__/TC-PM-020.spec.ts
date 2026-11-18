import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { stampOf } from './helpers'
import { readDocumentLines, readField, readSalesDocument } from './leaseFixtures'
import {
  bookingDay,
  cleanupBookingSetup,
  createBooking,
  createBookingSetup,
  HOURLY_PRICE,
  isConfirmed,
  postBooking,
  readBooking,
  settleBooking,
  type BookingSetup,
} from './bookingFixtures'

type SlotsBody = {
  openingHours: unknown
  slots: Array<{ start: string; end: string; state: 'free' | 'booked' }>
  price: { amount: string | null; currency: string | null; billingUnit: string }
}

/**
 * TC-PM-020: backoffice booking, concurrency and the booking order
 * A manager books a unit for a customer person without a portal account (`customerUserId` null):
 * the slot is held at once (202 pending) and the sales_operation worker confirms it with one sales
 * order (one line: the unit's product, quantity = hours, the catalog price). Five concurrent requests
 * for one slot leave exactly one hold; the rest get 409 booking_slot_taken. Slots show the booked hours.
 * The `property_management.booking.created` domain event is asserted in `__tests__/bookingCommands.test.ts`
 * (non-broadcast domain events cannot be observed through the API).
 */
test.describe('TC-PM-020: backoffice booking', () => {
  test('holds exactly one of several concurrent bookings of one slot and confirms it with a sales order', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: BookingSetup | null = null
    try {
      setup = await createBookingSetup(request, token, stamp)
      const [unitId] = setup.unitIds
      const day = bookingDay(3)
      const input = {
        unitId,
        startsAt: `${day}T10:00`,
        endsAt: `${day}T12:00`,
        bookedByPersonId: setup.personId as string,
        customerCompanyId: setup.companyId,
      }

      const responses = await Promise.all(Array.from({ length: 5 }, () => postBooking(request, token, input)))
      const statuses = responses.map((response) => response.status()).sort()
      expect(statuses, 'exactly one concurrent booking holds the slot').toEqual([202, 409, 409, 409, 409])
      const bodies = await Promise.all(responses.map((response) => readJsonSafe<{ id?: string; status?: string; code?: string }>(response)))
      const held = bodies.find((body) => body?.status === 'pending')
      expect(held?.id).toBeTruthy()
      setup.bookingIds.push(held?.id as string)
      for (const body of bodies.filter((entry) => entry?.status !== 'pending')) expect(body?.code).toBe('booking_slot_taken')

      const overlapping = await postBooking(request, token, { ...input, startsAt: `${day}T11:00`, endsAt: `${day}T13:00` })
      expect(overlapping.status(), 'an overlapping slot is taken while the first booking is pending').toBe(409)

      const adjacent = await createBooking(request, token, setup, { ...input, startsAt: `${day}T12:00`, endsAt: `${day}T13:00` })
      expect(adjacent).toBeTruthy()

      const pending = await readBooking(request, token, held?.id as string)
      expect(pending).toMatchObject({ unitId, customerUserId: null, quantity: 2, productName: expect.any(String) })
      expect(Number(pending?.unitPrice)).toBe(HOURLY_PRICE)
      expect(Number(pending?.totalAmount)).toBe(HOURLY_PRICE * 2)

      const slots = await readJsonSafe<SlotsBody>(await apiRequest(request, 'GET', `/api/property_management/units/${unitId}/slots?date=${day}`, { token }))
      expect(slots?.openingHours).toBeNull()
      expect(slots?.slots).toHaveLength(24)
      expect(slots?.slots.filter((slot) => slot.state === 'booked').map((slot) => slot.start)).toEqual([`${day}T10:00`, `${day}T11:00`, `${day}T12:00`])
      expect(slots?.price).toMatchObject({ currency: 'EUR', billingUnit: 'hour' })

      const confirmed = await settleBooking(request, token, held?.id as string, isConfirmed, 'the booking confirmation')
      const order = await readSalesDocument(request, token, 'orders', confirmed.salesOrderId as string)
      expect(order, 'the booking order is readable in sales').not.toBeNull()
      expect(readField(order, 'channelId', 'channel_id')).toBe(setup.channelId)
      const lines = await readDocumentLines(request, token, 'order', confirmed.salesOrderId as string)
      expect(lines).toHaveLength(1)
      expect(readField(lines[0], 'productId', 'product_id')).toBe(setup.productId)
      expect(Number(readField(lines[0], 'quantity'))).toBe(2)
      expect(Number(readField(lines[0], 'unitPriceNet', 'unit_price_net'))).toBe(HOURLY_PRICE)
      expect(confirmed.salesOrderNumber).toBeTruthy()
    } finally {
      await cleanupBookingSetup(request, token, setup)
    }
  })

  test('validates the booking rules and references', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: BookingSetup | null = null
    try {
      setup = await createBookingSetup(request, token, stamp)
      const [unitId] = setup.unitIds
      const day = bookingDay(3)
      const base = { unitId, bookedByPersonId: setup.personId as string, customerCompanyId: setup.companyId }
      const notOnHour = await postBooking(request, token, { ...base, startsAt: `${day}T10:30`, endsAt: `${day}T11:30` })
      expect(notOnHour.status()).toBe(422)
      expect((await readJsonSafe<{ code?: string }>(notOnHour))?.code).toBe('booking_not_on_the_hour')
      const tooLong = await postBooking(request, token, { ...base, startsAt: `${day}T08:00`, endsAt: `${day}T19:00` })
      expect((await readJsonSafe<{ code?: string }>(tooLong))?.code).toBe('booking_too_long')
      const past = await postBooking(request, token, { ...base, startsAt: `${bookingDay(-1)}T10:00`, endsAt: `${bookingDay(-1)}T11:00` })
      expect((await readJsonSafe<{ code?: string }>(past))?.code).toBe('booking_in_past')
      const foreignPerson = await postBooking(request, token, { ...base, bookedByPersonId: setup.companyId as string, startsAt: `${day}T10:00`, endsAt: `${day}T11:00` })
      expect(foreignPerson.status(), 'the person booking must be a person of the organization').toBe(422)
      const zoned = await postBooking(request, token, { ...base, startsAt: `${day}T10:00:00Z`, endsAt: `${day}T11:00:00Z` })
      expect(zoned.status(), 'booking times are building-local wall-clock without a zone').toBe(400)
    } finally {
      await cleanupBookingSetup(request, token, setup)
    }
  })
})
