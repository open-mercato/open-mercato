import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { computeAutopayHash } from '../lib/hash'
import {
  AUTOPAY_FIXTURE_SERVICE_ID,
  AUTOPAY_FIXTURE_SHARED_KEY,
  AUTOPAY_INTEGRATION_TEST_TIMEOUT_MS,
  configureAutopayIntegration,
  createAutopayScopeFixture,
  createAutopaySession,
  createMockProviderSession,
  getTransactionDetails,
  makeAutopayScheduleDue,
  readAutopayScheduleRows,
} from './helpers/fixtures'
import { pendingStatusXml } from './helpers/provider-responses'
import {
  drainAutopayPollerQueue,
  drainEventsQueue,
  readQueuedAutopayPollerJobs,
  requireInProcessPollerLane,
  runLocalSchedulerTick,
  withAutopayStatusStub,
} from './helpers/runtime'

/**
 * TC-AUTOPAY-002: The real scheduler dispatches the schedule onto the Autopay worker
 *
 * One tick of the local scheduler must pass the module-authored dispatch guard and
 * enqueue the trusted `payload.scope.{tenantId, organizationId}` on the module-owned
 * queue. Draining that queue runs the Autopay worker, which polls only `autopay`
 * transactions of that organization: the pending Autopay payment is polled with a
 * request signed by the tenant's key, while a non-terminal mock-provider transaction in
 * the same organization is left untouched. Autopay HTTP is stubbed in-process.
 */
test.describe('TC-AUTOPAY-002: scheduler dispatch to the Autopay poller', () => {
  test('dispatches the trusted scope onto the module queue and polls only Autopay transactions', async ({ request }) => {
    test.setTimeout(AUTOPAY_INTEGRATION_TEST_TIMEOUT_MS)
    requireInProcessPollerLane()

    const token = await getAuthToken(request, 'superadmin')
    const fixture = await createAutopayScopeFixture(request, token, 'tc-autopay-002', drainEventsQueue)

    try {
      const { scope, scheduleId } = fixture
      await configureAutopayIntegration(request, token, scope)
      const autopayPayment = await createAutopaySession(request, token, scope, 12.5)
      const controlPayment = await createMockProviderSession(request, token, scope)
      expect(autopayPayment.status).toBe('pending')
      expect(controlPayment.status).toBe('authorized')

      await makeAutopayScheduleDue(scheduleId)
      await runLocalSchedulerTick()

      const [scheduleRow] = await readAutopayScheduleRows(scope)
      expect(scheduleRow.last_run_at, 'the scheduler records the firing').not.toBeNull()
      expect(new Date(scheduleRow.next_run_at as Date).getTime(), 'the next run moves one interval ahead').toBeGreaterThan(Date.now())

      const dispatched = (await readQueuedAutopayPollerJobs()).filter(
        (job) => job.payload?.scope?.organizationId === scope.organizationId,
      )
      expect(dispatched, 'one tick enqueues one job for the organization').toHaveLength(1)
      expect(dispatched[0].payload).toMatchObject({
        limit: 100,
        scope: { tenantId: scope.tenantId, organizationId: scope.organizationId },
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        _jobOrigin: 'scheduler',
      })
      expect(dispatched[0].payload?.scope, 'the provider filter lives in the worker, never in the payload').not.toHaveProperty('providerKey')
      expect(typeof dispatched[0].payload?._idempotencyKey).toBe('string')

      const { requests } = await withAutopayStatusStub(
        (statusRequest) => ({ status: 200, body: pendingStatusXml(statusRequest.orderId, 12.5) }),
        () => drainAutopayPollerQueue(),
      )

      const autopayRequests = requests.filter((entry) => entry.orderId === autopayPayment.sessionId)
      expect(autopayRequests, 'the pending Autopay payment is polled exactly once').toHaveLength(1)
      expect(autopayRequests[0]).toEqual({
        serviceId: AUTOPAY_FIXTURE_SERVICE_ID,
        orderId: autopayPayment.sessionId,
        hash: computeAutopayHash([AUTOPAY_FIXTURE_SERVICE_ID, autopayPayment.sessionId], AUTOPAY_FIXTURE_SHARED_KEY),
      })
      expect(requests.some((entry) => entry.orderId === controlPayment.sessionId)).toBe(false)

      const autopayAfter = await getTransactionDetails(request, token, scope, autopayPayment.transactionId)
      expect(autopayAfter.transaction.unifiedStatus).toBe('pending')
      expect(autopayAfter.transaction.lastPolledAt, 'a poll without a transition still stamps lastPolledAt').not.toBeNull()

      const controlAfter = await getTransactionDetails(request, token, scope, controlPayment.transactionId)
      expect(controlAfter.transaction.unifiedStatus).toBe('authorized')
      expect(controlAfter.transaction.lastPolledAt, 'the mock-provider transaction is never polled').toBeNull()
    } finally {
      await fixture.cleanup()
    }
  })
})
