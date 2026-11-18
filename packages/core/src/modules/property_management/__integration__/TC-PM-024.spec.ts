import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { stampOf } from './helpers'
import {
  drainSalesOperations,
  runSweepQueue,
  SALES_OPERATION_QUEUE,
  skipOrFailUnsettled,
  workersRequired,
  type QueueDrain,
} from './leaseFixtures'
import {
  bookingDay,
  cleanupBookingSetup,
  createBooking,
  createBookingSetup,
  isConfirmed,
  readBooking,
  settleBooking,
  type BookingSetup,
} from './bookingFixtures'

const BOOKING_SWEEP_QUEUE = 'property_management.booking_sweep'

type HeldOperation = { status: string | null; drained: QueueDrain | null }

async function loseBookingOrderJob(bookingId: string, scope: { tenantId: string; organizationId: string }): Promise<HeldOperation> {
  return withClient(async (client) => {
    await client.query('begin')
    try {
      const held = await client.query<{ status: string }>(
        `select status from property_management_sales_operations
          where organization_id = $1 and tenant_id = $2 and target_id = $3 and kind = 'booking_order'
          for update`,
        [scope.organizationId, scope.tenantId, bookingId],
      )
      const status = held.rows[0]?.status ?? null
      if (status !== 'pending') {
        await client.query('rollback')
        return { status, drained: null }
      }
      const drained = await drainSalesOperations()
      await client.query(
        `update property_management_sales_operations set created_at = now() - interval '30 days'
          where organization_id = $1 and tenant_id = $2 and target_id = $3 and kind = 'booking_order'`,
        [scope.organizationId, scope.tenantId, bookingId],
      )
      await client.query(
        `update property_management_bookings set created_at = now() - interval '30 days'
          where organization_id = $1 and tenant_id = $2 and id = $3`,
        [scope.organizationId, scope.tenantId, bookingId],
      )
      await client.query('commit')
      return { status, drained }
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  })
}

/**
 * TC-PM-024: booking sweep
 * The booking sweep re-enqueues booking sales operations that are not done, so a booking whose order
 * job was lost is confirmed once the sales queue runs, and the sweep never releases a hold for being
 * old. The job is lost deterministically: the test holds the operation row while the sales queue
 * drains, so the worker finds it locked and drops the job, and back-dates the booking and its
 * operation by 30 days. Completion of past confirmed bookings is covered by
 * `__tests__/bookingCommands.test.ts` (a past booking cannot be created through the API).
 */
test.describe('TC-PM-024: booking sweep', () => {
  test('re-enqueues a lost booking operation and never releases a hold by age', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = getTokenContext(token)
    const stamp = stampOf()
    let setup: BookingSetup | null = null
    try {
      setup = await createBookingSetup(request, token, stamp)
      const [unitId] = setup.unitIds
      const day = bookingDay(7)
      const bookingId = await createBooking(request, token, setup, {
        unitId,
        startsAt: `${day}T15:00`,
        endsAt: `${day}T16:00`,
        bookedByPersonId: setup.personId as string,
        customerCompanyId: setup.companyId,
      })

      const held = await loseBookingOrderJob(bookingId, scope)
      expect(held.status, 'the booking records a booking_order operation').not.toBeNull()
      test.skip(
        held.status !== 'pending' && !workersRequired(),
        `the app's background worker ran the booking order (${held.status}) before the test could hold it; the lost-job case runs with AUTO_SPAWN_WORKERS=false, as in CI`,
      )
      expect(held.status, 'the booking order operation is still pending when held').toBe('pending')
      if (held.drained && !held.drained.ran) skipOrFailUnsettled(SALES_OPERATION_QUEUE, held.drained, 'the booking order job could not be dropped')
      const lost = await readBooking(request, token, bookingId)
      expect(lost?.status, 'the dropped job left the booking pending').toBe('pending')

      await runSweepQueue(BOOKING_SWEEP_QUEUE, scope)
      const afterSweep = await readBooking(request, token, bookingId)
      expect(afterSweep?.status, 'the sweep never cancels a held booking, however old').not.toBe('cancelled')
      expect(afterSweep?.cancelReason ?? null).toBeNull()

      const confirmed = await settleBooking(request, token, bookingId, isConfirmed, 'the swept booking confirmation')
      expect(confirmed.status).toBe('confirmed')
    } finally {
      await cleanupBookingSetup(request, token, setup)
    }
  })
})
