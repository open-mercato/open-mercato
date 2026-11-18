import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { setProductUse, stampOf } from './helpers'
import {
  bookingDay,
  cleanupBookingSetup,
  createBooking,
  createBookingSetup,
  HOURLY_PRICE,
  readBooking,
  SECOND_HOURLY_PRICE,
  type BookingSetup,
} from './bookingFixtures'

/**
 * TC-PM-022: "Booked as" snapshot and booking usage guards
 * A booking keeps the product and price it was made at after the unit's product changes; new bookings
 * take the new product and price. While an upcoming booking exists the product's use cannot become
 * leasable, the unit cannot be deleted and the building can be neither archived nor deleted.
 */
test.describe('TC-PM-022: booking snapshot and usage guards', () => {
  test('keeps the booked product and price after a product change', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: BookingSetup | null = null
    try {
      setup = await createBookingSetup(request, token, stamp)
      const [unitId] = setup.unitIds
      const day = bookingDay(3)
      const base = { unitId, bookedByPersonId: setup.personId as string, customerCompanyId: setup.companyId }
      const firstId = await createBooking(request, token, setup, { ...base, startsAt: `${day}T09:00`, endsAt: `${day}T11:00` })
      const before = await readBooking(request, token, firstId)

      const useChange = await setProductUse(request, token, setup.productId as string, 'leasable', 'month')
      expect(useChange.status(), 'a product in use with upcoming bookings cannot become leasable').toBe(409)

      const unitDelete = await apiRequest(request, 'DELETE', `/api/property_management/units?id=${encodeURIComponent(unitId)}`, { token })
      expect(unitDelete.status(), 'a unit with upcoming bookings cannot be deleted').toBe(409)

      const archive = await apiRequest(request, 'POST', `/api/property_management/buildings/${setup.buildingId}/archive`, { token })
      expect(archive.status(), 'a building with upcoming bookings cannot be archived').toBe(409)
      expect((await readJsonSafe<{ code?: string }>(archive))?.code).toBe('building_archive_blocked')
      const usage = await readJsonSafe<{ canDelete?: boolean }>(
        await apiRequest(request, 'GET', `/api/property_management/buildings/${setup.buildingId}/archive`, { token }),
      )
      expect(usage?.canDelete, 'a building that ever had a booking is not deletable').toBe(false)

      const productChange = await apiRequest(request, 'POST', `/api/property_management/units/${unitId}/product`, {
        token,
        data: { catalogProductId: setup.secondProductId },
      })
      expect(productChange.status(), `POST units/{id}/product → ${JSON.stringify(await readJsonSafe(productChange))}`).toBeLessThan(300)

      const after = await readBooking(request, token, firstId)
      expect(after?.productName, 'the booking keeps the product it was made at').toBe(before?.productName)
      expect(Number(after?.unitPrice)).toBe(HOURLY_PRICE)
      expect(Number(after?.totalAmount)).toBe(HOURLY_PRICE * 2)

      const secondId = await createBooking(request, token, setup, { ...base, startsAt: `${day}T13:00`, endsAt: `${day}T14:00` })
      const second = await readBooking(request, token, secondId)
      expect(second?.productName).not.toBe(before?.productName)
      expect(Number(second?.unitPrice)).toBe(SECOND_HOURLY_PRICE)
    } finally {
      await cleanupBookingSetup(request, token, setup)
    }
  })
})
