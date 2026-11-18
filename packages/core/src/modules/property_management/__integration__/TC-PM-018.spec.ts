import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { listNotifications } from '@open-mercato/core/helpers/integration/notificationsFixtures'
import { stampOf } from './helpers'
import { createManagers, deleteManagers, type ManagerFixture } from './staffFixtures'
import {
  cleanupLeaseSetup,
  createLease,
  createLeaseSetup,
  drainSalesOperations,
  isoDayFromToday,
  type LeaseSetup,
} from './leaseFixtures'
import {
  bookingDay,
  cancelBooking,
  cleanupBookingSetup,
  createBooking,
  createBookingSetup,
  isConfirmed,
  settleBooking,
  type BookingSetup,
} from './bookingFixtures'

async function recordHeldPayment(request: APIRequestContext, token: string, orderId: string): Promise<void> {
  const response = await apiRequest(request, 'POST', '/api/sales/payments', {
    token,
    data: { orderId, amount: '10.00', currencyCode: 'EUR', receivedAt: new Date().toISOString() },
  })
  expect(response.status(), `POST payments → ${JSON.stringify(await readJsonSafe(response))}`).toBe(201)
}

/**
 * TC-PM-018: lease building access and staff notifications
 * Manager A cannot list, open, end, extend or delete a lease in manager B's building (filtered / 404).
 * Staff notifications go to the building audience: when sales refuses to cancel the order of a
 * booking in manager A's building because it holds a payment (the deterministic refusal of TC-PM-021),
 * `booking.order_cancel_refused` reaches manager A and the administrators, never manager B. Lease
 * billing notifications use the same audience (`lib/staffRecipients.ts`).
 */
test.describe('TC-PM-018: lease access and staff notifications', () => {
  test('scopes leases to the managers of their building', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let managers: ManagerFixture | null = null
    let setup: LeaseSetup | null = null
    try {
      managers = await createManagers(request, adminToken, stamp, 2, ['property_management.leases.manage'])
      const [managerA, managerB] = managers.users
      setup = await createLeaseSetup(request, adminToken, stamp, { managerUserIds: [managerB.id] })
      const lease = await createLease(request, adminToken, setup, {
        unitId: setup.unitIds[0],
        customerCompanyId: setup.companyIds[0],
        startsOn: isoDayFromToday(10),
        termMonths: 6,
      })

      const listA = await readJsonSafe<{ items?: Array<{ id: string }> }>(
        await apiRequest(request, 'GET', `/api/property_management/leases?id=${lease.id}`, { token: managerA.token }),
      )
      expect(listA?.items ?? []).toHaveLength(0)
      const listB = await readJsonSafe<{ items?: Array<{ id: string }> }>(
        await apiRequest(request, 'GET', `/api/property_management/leases?id=${lease.id}`, { token: managerB.token }),
      )
      expect((listB?.items ?? []).map((item) => item.id)).toEqual([lease.id])

      const detailA = await apiRequest(request, 'GET', `/api/property_management/leases/${lease.id}`, { token: managerA.token })
      expect(detailA.status()).toBe(404)
      const endA = await apiRequest(request, 'POST', `/api/property_management/leases/${lease.id}/end`, {
        token: managerA.token,
        data: { endsOn: isoDayFromToday(20), settlement: 'keep' },
      })
      expect(endA.status()).toBe(404)
      const extendA = await apiRequest(request, 'POST', `/api/property_management/leases/${lease.id}/extensions`, {
        token: managerA.token,
        data: { months: 3, monthlyRate: 1000, asProposal: false },
      })
      expect(extendA.status()).toBe(404)
      const deleteA = await apiRequest(request, 'DELETE', `/api/property_management/leases?id=${lease.id}`, { token: managerA.token })
      expect(deleteA.status()).toBe(404)
      const createA = await apiRequest(request, 'POST', '/api/property_management/leases', {
        token: managerA.token,
        data: { unitId: setup.unitIds[0], customerCompanyId: setup.companyIds[0], startsOn: isoDayFromToday(400), termMonths: 3, monthlyRate: 1000, asProposal: false },
      })
      expect(createA.status(), "manager A cannot lease a unit of B's building").toBe(422)

      const detailB = await apiRequest(request, 'GET', `/api/property_management/leases/${lease.id}`, { token: managerB.token })
      expect(detailB.status()).toBe(200)
    } finally {
      await cleanupLeaseSetup(request, adminToken, setup)
      await deleteManagers(request, adminToken, managers)
    }
  })

  test('sends the order-cancel-refused notification to the building managers and administrators only', async ({ request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let managers: ManagerFixture | null = null
    let setup: BookingSetup | null = null
    try {
      managers = await createManagers(request, adminToken, stamp, 2, ['property_management.bookings.manage'])
      const [managerA, managerB] = managers.users
      setup = await createBookingSetup(request, adminToken, stamp, { managerUserIds: [managerA.id] })
      const day = bookingDay(6)
      const bookingId = await createBooking(request, adminToken, setup, {
        unitId: setup.unitIds[0],
        startsAt: `${day}T11:00`,
        endsAt: `${day}T12:00`,
        bookedByPersonId: setup.personId as string,
        customerCompanyId: setup.companyId,
      })
      const confirmed = await settleBooking(request, adminToken, bookingId, isConfirmed, 'the booking confirmation')
      await recordHeldPayment(request, adminToken, confirmed.salesOrderId as string)

      const cancelled = await cancelBooking(request, managerA.token, bookingId)
      expect(cancelled.status(), `POST cancel → ${JSON.stringify(await readJsonSafe(cancelled))}`).toBe(200)
      await drainSalesOperations()

      const type = 'property_management.booking.order_cancel_refused'
      const notifiedFor = async (token: string) =>
        (await listNotifications(request, token, { type })).items.some((item) => item.sourceEntityId === bookingId)
      await expect.poll(() => notifiedFor(managerA.token), { timeout: 15_000, message: 'manager A is notified' }).toBe(true)
      expect(await notifiedFor(adminToken), 'the administrator is notified').toBe(true)
      expect(await notifiedFor(managerB.token), 'manager B is not notified').toBe(false)
    } finally {
      await cleanupBookingSetup(request, adminToken, setup)
      await deleteManagers(request, adminToken, managers)
    }
  })
})
