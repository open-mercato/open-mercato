import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { listNotifications } from '@open-mercato/core/helpers/integration/notificationsFixtures'
import { stampOf } from './helpers'
import { listChannelDocumentIds } from './salesFixtures'
import { drainSalesOperations, readField, readSalesDocument } from './leaseFixtures'
import {
  bookingDay,
  cancelBooking,
  cleanupBookingSetup,
  createBooking,
  createBookingSetup,
  isConfirmed,
  readBooking,
  settleBooking,
  type BookingSetup,
} from './bookingFixtures'

async function ensurePaymentStatus(request: APIRequestContext, token: string, value: string): Promise<{ id: string; created: boolean }> {
  const response = await apiRequest(request, 'GET', '/api/sales/payment-statuses?pageSize=100', { token })
  expect(response.status(), 'GET payment-statuses should return 200').toBe(200)
  const body = await readJsonSafe<{ items?: Array<{ id: string; value: string }> }>(response)
  const existing = body?.items?.find((item) => item.value === value)
  if (existing) return { id: existing.id, created: false }
  const created = await apiRequest(request, 'POST', '/api/sales/payment-statuses', { token, data: { value, label: `QA PM ${value}` } })
  const createdBody = await readJsonSafe<{ id?: string }>(created)
  expect(created.ok(), `POST payment-statuses → ${created.status()} ${JSON.stringify(createdBody)}`).toBeTruthy()
  return { id: expectId(createdBody?.id, 'Payment status id'), created: true }
}

async function readOrderCancelRefusals(request: APIRequestContext, token: string, bookingId: string): Promise<number> {
  const notifications = await listNotifications(request, token, { type: 'property_management.booking.order_cancel_refused' })
  return notifications.items.filter((item) => item.sourceEntityId === bookingId).length
}

async function recordPayment(request: APIRequestContext, token: string, orderId: string, statusEntryId: string | null) {
  const response = await apiRequest(request, 'POST', '/api/sales/payments', {
    token,
    data: {
      orderId,
      amount: '10.00',
      currencyCode: 'EUR',
      receivedAt: new Date().toISOString(),
      ...(statusEntryId ? { statusEntryId } : {}),
    },
  })
  const body = await readJsonSafe<{ id?: string; paymentId?: string }>(response)
  expect(response.status(), `POST payments → ${JSON.stringify(body)}`).toBe(201)
  return expectId(body?.id ?? body?.paymentId, 'Payment id')
}

async function listPaymentIds(request: APIRequestContext, token: string, orderId: string): Promise<string[]> {
  const payments = await readJsonSafe<{ items?: Array<{ id: string }> }>(
    await apiRequest(request, 'GET', `/api/sales/payments?orderId=${encodeURIComponent(orderId)}`, { token }),
  )
  return (payments?.items ?? []).map((item) => item.id)
}

/**
 * TC-PM-021: cancelling a booking
 * A manager cancels a confirmed booking: the booking becomes `cancelled` (reason `manager`), its slot is
 * free again, and its sales order is moved to the sales order status configured as cancelled — never
 * deleted, so a (pending) payment recorded on the order just before the cancel survives. Cancelling
 * again → 409. Sales refuses to cancel an order that still holds money (#4054): the booking is still
 * cancelled and its slot released, while the order keeps its status and its payment, and the building staff
 * get a `booking.order_cancel_refused` notification.
 * A booking cancelled right after it is made is released whether or not the background worker has already
 * created its order (a pending or a confirmed booking can both be cancelled); it never becomes confirmed
 * afterwards, and a late order is moved to the cancelled status.
 */
test.describe('TC-PM-021: cancel a booking', () => {
  test('moves the order to the cancelled status and keeps the order and its payment', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: BookingSetup | null = null
    let createdPaymentStatusId: string | null = null
    try {
      setup = await createBookingSetup(request, token, stamp)
      const [unitId] = setup.unitIds
      const day = bookingDay(4)
      const input = { unitId, startsAt: `${day}T09:00`, endsAt: `${day}T10:00`, bookedByPersonId: setup.personId as string, customerCompanyId: setup.companyId }
      const bookingId = await createBooking(request, token, setup, input)
      const confirmed = await settleBooking(request, token, bookingId, isConfirmed, 'the booking confirmation')
      const orderId = confirmed.salesOrderId as string

      const pendingStatus = await ensurePaymentStatus(request, token, 'pending')
      if (pendingStatus.created) createdPaymentStatusId = pendingStatus.id
      const paymentId = await recordPayment(request, token, orderId, pendingStatus.id)

      const cancelled = await cancelBooking(request, token, bookingId)
      expect(cancelled.status(), `POST cancel → ${JSON.stringify(await readJsonSafe(cancelled))}`).toBe(200)
      const again = await cancelBooking(request, token, bookingId)
      expect(again.status()).toBe(409)
      expect((await readJsonSafe<{ code?: string }>(again))?.code).toBe('booking_not_cancellable')

      await drainSalesOperations()
      await expect
        .poll(async () => (await readBooking(request, token, bookingId))?.salesOrderCancelled ?? null, {
          timeout: 15_000,
          message: 'the order reaches the cancelled status',
        })
        .toBe(true)
      const row = await readBooking(request, token, bookingId)
      expect(row).toMatchObject({ status: 'cancelled', cancelReason: 'manager', salesOrderId: orderId, salesOrderCancelled: true })
      const order = await readSalesDocument(request, token, 'orders', orderId)
      expect(order, 'the booking order is never deleted').not.toBeNull()
      expect(readField(order, 'statusEntryId', 'status_entry_id')).toBe(setup.cancelledStatusEntryId)
      expect(await listPaymentIds(request, token, orderId), 'the payment recorded before the cancel survives').toContain(paymentId)

      const rebooked = await createBooking(request, token, setup, input)
      expect(rebooked, 'the released slot can be booked again').toBeTruthy()
    } finally {
      await cleanupBookingSetup(request, token, setup)
      if (createdPaymentStatusId) await deleteEntityIfExists(request, token, '/api/sales/payment-statuses', createdPaymentStatusId)
    }
  })

  test('keeps a paid order and its payment when sales refuses to cancel it', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: BookingSetup | null = null
    try {
      setup = await createBookingSetup(request, token, stamp)
      const [unitId] = setup.unitIds
      const day = bookingDay(6)
      const input = { unitId, startsAt: `${day}T11:00`, endsAt: `${day}T12:00`, bookedByPersonId: setup.personId as string, customerCompanyId: setup.companyId }
      const bookingId = await createBooking(request, token, setup, input)
      const confirmed = await settleBooking(request, token, bookingId, isConfirmed, 'the booking confirmation')
      const orderId = confirmed.salesOrderId as string
      const before = await readSalesDocument(request, token, 'orders', orderId)
      const paymentId = await recordPayment(request, token, orderId, null)

      const cancelled = await cancelBooking(request, token, bookingId)
      expect(cancelled.status(), `POST cancel → ${JSON.stringify(await readJsonSafe(cancelled))}`).toBe(200)
      await drainSalesOperations()
      await expect
        .poll(() => readOrderCancelRefusals(request, token, bookingId), {
          timeout: 15_000,
          message: 'the building staff are told the order stayed open',
        })
        .toBeGreaterThan(0)

      const row = await readBooking(request, token, bookingId)
      expect(row).toMatchObject({ status: 'cancelled', cancelReason: 'manager', salesOrderId: orderId, salesOrderCancelled: false })
      const order = await readSalesDocument(request, token, 'orders', orderId)
      expect(order, 'the booking order is never deleted').not.toBeNull()
      expect(readField(order, 'statusEntryId', 'status_entry_id'), 'sales keeps an order holding money out of the cancelled status').toBe(
        readField(before, 'statusEntryId', 'status_entry_id'),
      )
      expect(await listPaymentIds(request, token, orderId), 'the payment survives').toContain(paymentId)
      expect(await createBooking(request, token, setup, input), 'the released slot can be booked again').toBeTruthy()
    } finally {
      await cleanupBookingSetup(request, token, setup)
    }
  })

  test('cancels a pending booking so it never becomes confirmed', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let setup: BookingSetup | null = null
    try {
      setup = await createBookingSetup(request, token, stamp)
      const [unitId] = setup.unitIds
      const day = bookingDay(5)
      const bookingId = await createBooking(request, token, setup, {
        unitId,
        startsAt: `${day}T14:00`,
        endsAt: `${day}T15:00`,
        bookedByPersonId: setup.personId as string,
      })
      const cancelled = await cancelBooking(request, token, bookingId)
      const body = await readJsonSafe<{ status?: string }>(cancelled)
      expect(cancelled.status(), `POST cancel of a held booking → ${JSON.stringify(body)}`).toBe(200)
      expect(body?.status).toBe('cancelled')
      await drainSalesOperations()
      const settled = await settleBooking(
        request,
        token,
        bookingId,
        (row) => row.status !== 'pending' && (!row.salesOrderId || row.salesOrderCancelled),
        'the cancelled booking and its late order',
        20,
      )
      expect(settled.status, 'a released hold is never confirmed by its late operation').toBe('cancelled')
      const channelOrders = await listChannelDocumentIds(request, token, 'orders', setup.channelId as string)
      const lateOrderId = settled.salesOrderId
      expect(channelOrders, 'the booking has no order, or only the late order it links').toEqual(lateOrderId ? [lateOrderId] : [])
      for (const id of channelOrders ?? []) {
        const order = await readSalesDocument(request, token, 'orders', id)
        expect(readField(order, 'statusEntryId', 'status_entry_id'), 'a late order is moved to the cancelled status').toBe(setup.cancelledStatusEntryId)
      }
    } finally {
      await cleanupBookingSetup(request, token, setup)
    }
  })
})
