import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createBuilding, createUnit, deleteBuildingIfExists, listFloors, listSpaces, stampOf } from './helpers'
import { createManagers, deleteManagers, type ManagerFixture } from './staffFixtures'
import { bookingDay, cancelBooking, cleanupBookingSetup, createBooking, createBookingSetup, postBooking, type BookingSetup } from './bookingFixtures'

type ListBody = { items?: Array<{ id: string }> }

/**
 * TC-PM-023: building access for bookings
 * Manager A (assigned to building A, holding property_management.bookings.manage) sees and cancels
 * only the bookings of building A. A booking in building B is filtered from A's list, 404 on cancel,
 * B's unit cannot be booked (422) and its slots are 404. Full exports of bookings and units
 * (`exportScope=full` / `full=true`) leave out building B too. An administrator (manage_all) sees both.
 * Without property_management.bookings.manage a manager cannot book or cancel (403).
 */
test.describe('TC-PM-023: booking building access', () => {
  test('scopes bookings to the managers of their building', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let managers: ManagerFixture | null = null
    let viewers: ManagerFixture | null = null
    let setup: BookingSetup | null = null
    let buildingB: string | null = null
    try {
      managers = await createManagers(request, adminToken, `${stamp}-m`, 1, ['property_management.bookings.manage'])
      viewers = await createManagers(request, adminToken, `${stamp}-v`, 1)
      const [managerA] = managers.users
      const [viewer] = viewers.users
      setup = await createBookingSetup(request, adminToken, stamp, { managerUserIds: [managerA.id, viewer.id] })
      const [unitA] = setup.unitIds
      buildingB = await createBuilding(request, adminToken, { name: `QA PM Bookings B ${stamp}`, size: { x: 20, y: 10 } })
      const [floorB] = await listFloors(request, adminToken, buildingB)
      const [spaceB] = await listSpaces(request, adminToken, floorB.id)
      const unitResponse = await createUnit(request, adminToken, {
        floorId: floorB.id,
        spaceId: spaceB.id,
        name: `Room B ${stamp}`,
        catalogCategoryId: setup.categoryId,
        catalogProductId: setup.productId,
        x: 0,
        y: 0,
        width: 4,
        depth: 4,
      })
      expect(unitResponse.status()).toBe(201)
      const unitB = (await readJsonSafe<{ id: string }>(unitResponse))?.id as string
      const day = bookingDay(6)
      const person = { bookedByPersonId: setup.personId as string, customerCompanyId: setup.companyId }
      const bookingA = await createBooking(request, adminToken, setup, { unitId: unitA, startsAt: `${day}T09:00`, endsAt: `${day}T10:00`, ...person })
      const bookingB = await createBooking(request, adminToken, setup, { unitId: unitB, startsAt: `${day}T09:00`, endsAt: `${day}T10:00`, ...person })

      const listA = await readJsonSafe<ListBody>(await apiRequest(request, 'GET', `/api/property_management/bookings?date=${day}&pageSize=100`, { token: managerA.token }))
      const idsA = (listA?.items ?? []).map((item) => item.id)
      expect(idsA).toContain(bookingA)
      expect(idsA).not.toContain(bookingB)
      const detailB = await readJsonSafe<ListBody>(await apiRequest(request, 'GET', `/api/property_management/bookings?id=${bookingB}`, { token: managerA.token }))
      expect(detailB?.items ?? []).toHaveLength(0)

      for (const exportQuery of ['format=json&exportScope=full', 'format=csv&full=true']) {
        const exportedBookings = await apiRequest(request, 'GET', `/api/property_management/bookings?${exportQuery}`, { token: managerA.token })
        expect(exportedBookings.status(), `bookings full export (${exportQuery})`).toBe(200)
        const bookingsText = await exportedBookings.text()
        expect(bookingsText).toContain(bookingA)
        expect(bookingsText, 'a full export leaves out bookings of building B').not.toContain(bookingB)
        const exportedUnits = await apiRequest(request, 'GET', `/api/property_management/units?${exportQuery}`, { token: managerA.token })
        expect(exportedUnits.status(), `units full export (${exportQuery})`).toBe(200)
        const unitsText = await exportedUnits.text()
        expect(unitsText).toContain(unitA)
        expect(unitsText, 'a full export leaves out units of building B').not.toContain(unitB)
      }
      const adminExport = await (await apiRequest(request, 'GET', '/api/property_management/bookings?format=json&exportScope=full', { token: adminToken })).text()
      expect(adminExport).toContain(bookingA)
      expect(adminExport).toContain(bookingB)

      const adminList = await readJsonSafe<ListBody>(await apiRequest(request, 'GET', `/api/property_management/bookings?date=${day}&pageSize=100`, { token: adminToken }))
      expect((adminList?.items ?? []).map((item) => item.id)).toEqual(expect.arrayContaining([bookingA, bookingB]))

      expect((await cancelBooking(request, managerA.token, bookingB)).status(), 'cancel outside the assigned buildings').toBe(404)
      const slotsB = await apiRequest(request, 'GET', `/api/property_management/units/${unitB}/slots?date=${day}`, { token: managerA.token })
      expect(slotsB.status()).toBe(404)
      const bookB = await postBooking(request, managerA.token, { unitId: unitB, startsAt: `${day}T11:00`, endsAt: `${day}T12:00`, ...person })
      expect(bookB.status(), 'a unit outside the assigned buildings cannot be booked').toBe(422)

      const viewerBook = await postBooking(request, viewer.token, { unitId: unitA, startsAt: `${day}T11:00`, endsAt: `${day}T12:00`, ...person })
      expect(viewerBook.status(), 'booking needs property_management.bookings.manage').toBe(403)
      expect((await cancelBooking(request, viewer.token, bookingA)).status()).toBe(403)

      expect((await cancelBooking(request, managerA.token, bookingA)).status(), 'manager A cancels a booking of building A').toBe(200)
    } finally {
      await cleanupBookingSetup(request, adminToken, setup)
      if (buildingB) {
        await apiRequest(request, 'POST', `/api/property_management/buildings/${buildingB}/archive`, { token: adminToken }).catch(() => undefined)
        await deleteBuildingIfExists(request, adminToken, buildingB)
      }
      await deleteManagers(request, adminToken, managers)
      await deleteManagers(request, adminToken, viewers)
    }
  })
})
