import { expect, test, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { listFloors, stampOf } from './helpers'
import { bookingDay, cleanupBookingSetup, createBooking, createBookingSetup, type BookingSetup } from './bookingFixtures'
import { watchHydration } from './hydrationWatch'

type ListedBooking = { id: string; unitId: string; cancellable?: boolean }

async function openUnitBookings(page: Page, unitId: string, unitName: string, day: string): Promise<void> {
  await page.getByTestId(`pm-floor-plan-unit-${unitId}`).click()
  const drawer = page.getByTestId('pm-floor-plan-drawer')
  await expect(drawer).toContainText(unitName)
  await drawer.getByTestId('pm-floor-plan-open-bookings').click()
  await page.waitForURL((url) => url.pathname === '/backend/property_management/bookings' && url.searchParams.get('unitId') === unitId)
  const url = new URL(page.url())
  expect(url.searchParams.get('unitName')).toBe(unitName)
  expect(url.searchParams.get('date')).toBe(day)
}

/**
 * TC-PM-073: floor plan drawer → Open bookings → bookings list filtered to the unit
 * The API filters `GET bookings` by `unitId` and marks an upcoming booking `cancellable`. In the UI, the
 * drawer's "Open bookings" link opens the bookings list for that unit and day: the "Only unit …" chip names
 * the unit (also for a free unit with no bookings, where the list is empty), only that unit's booking is
 * listed, and clearing the chip shows the bookings of every unit again.
 * The manager-cancel `409 booking_already_ended` path is covered by unit tests only: the API refuses to
 * create a booking in the past, so an ended booking cannot be built as a fixture.
 */
test.describe('TC-PM-073: bookings list opened from the floor plan drawer', () => {
  test('filters the list to the unit from the drawer and names it in the chip', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: BookingSetup | null = null
    try {
      setup = await createBookingSetup(request, token, stamp, { units: 2 })
      const [bookedUnit, freeUnit] = setup.unitIds
      const bookedName = `Room 1 ${stamp}`
      const freeName = `Room 2 ${stamp}`
      const day = bookingDay(2)
      const bookingId = await createBooking(request, token, setup, {
        unitId: bookedUnit,
        startsAt: `${day}T10:00`,
        endsAt: `${day}T12:00`,
        bookedByPersonId: setup.personId as string,
        customerCompanyId: setup.companyId,
      })

      const listResponse = await apiRequest(request, 'GET', `/api/property_management/bookings?unitId=${bookedUnit}&date=${day}`, { token })
      const listBody = await readJsonSafe<{ items?: ListedBooking[] }>(listResponse)
      expect(listResponse.status(), `GET bookings?unitId → ${JSON.stringify(listBody)}`).toBe(200)
      expect(listBody?.items?.map((item) => item.id)).toEqual([bookingId])
      expect(listBody?.items?.[0]).toMatchObject({ unitId: bookedUnit, cancellable: true })

      const freeResponse = await apiRequest(request, 'GET', `/api/property_management/bookings?unitId=${freeUnit}&date=${day}`, { token })
      const freeBody = await readJsonSafe<{ items?: ListedBooking[] }>(freeResponse)
      expect(freeResponse.status()).toBe(200)
      expect(freeBody?.items ?? []).toEqual([])

      const [floor] = await listFloors(request, token, setup.buildingId as string)
      const floorPlanUrl = `/backend/property_management/floor-plan?buildingId=${setup.buildingId}&floorId=${floor.id}&date=${day}`
      const watch = watchHydration(page)
      await login(page, 'admin')

      await page.goto(floorPlanUrl)
      await expect(page.getByTestId('floor-drawing')).toBeVisible()
      await openUnitBookings(page, freeUnit, freeName, day)
      const chip = page.getByTestId('pm-bookings-unit-filter')
      await expect(chip).toContainText(`Only unit ${freeName}`)
      await expect(chip).not.toContainText(freeUnit.slice(0, 8))
      await expect(page.getByText('No bookings', { exact: true })).toBeVisible()

      await page.goto(floorPlanUrl)
      await expect(page.getByTestId('floor-drawing')).toBeVisible()
      await openUnitBookings(page, bookedUnit, bookedName, day)
      await expect(chip).toContainText(`Only unit ${bookedName}`)
      await expect(page.getByRole('row').filter({ hasText: bookedName })).toHaveCount(1)
      await expect(page.getByRole('row').filter({ hasText: freeName })).toHaveCount(0)

      await page.getByLabel('Show bookings of all units').click()
      await page.waitForURL((url) => url.pathname === '/backend/property_management/bookings' && !url.searchParams.has('unitId'))
      expect(new URL(page.url()).searchParams.has('unitName')).toBe(false)
      await expect(chip).toBeHidden()
      await expect(page.getByRole('row').filter({ hasText: bookedName })).toHaveCount(1)
      watch.assertClean()
    } finally {
      await cleanupBookingSetup(request, token, setup)
    }
  })
})
