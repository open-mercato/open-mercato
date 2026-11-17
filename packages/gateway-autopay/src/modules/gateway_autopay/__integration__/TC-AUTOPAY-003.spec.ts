import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  AUTOPAY_INTEGRATION_TEST_TIMEOUT_MS,
  configureAutopayIntegration,
  createAutopayScopeFixture,
  createAutopaySession,
  getTransactionDetails,
  makeAutopayScheduleDue,
  type GatewayTransactionDetails,
} from './helpers/fixtures'
import { settledStatusXml } from './helpers/provider-responses'
import {
  drainAutopayPollerQueue,
  drainEventsQueue,
  resolveInProcessPollerSkipReason,
  runLocalSchedulerTick,
  withAutopayStatusStub,
} from './helpers/runtime'

const POLLER_TRANSITION_MESSAGE = 'Payment status updated by poller'

function pollerTransitionLogs(details: GatewayTransactionDetails) {
  return details.logs.filter((entry) => entry.message === POLLER_TRANSITION_MESSAGE)
}

/**
 * TC-AUTOPAY-003: A settled payment is reconciled to `captured`
 *
 * A pending Autopay payment whose stubbed `transactionStatus` answer is a signed
 * `SUCCESS` record reaches `captured` through one scheduler tick and one worker run,
 * with exactly one poller transition log entry. A second cycle neither polls the now
 * terminal payment again nor adds a second transition entry.
 */
test.describe('TC-AUTOPAY-003: settled payment reconciliation', () => {
  test('drives a pending payment to captured with one canonical transition', async ({ request }) => {
    test.setTimeout(AUTOPAY_INTEGRATION_TEST_TIMEOUT_MS)
    const skipReason = resolveInProcessPollerSkipReason()
    test.skip(skipReason !== null, skipReason ?? '')

    const token = await getAuthToken(request, 'superadmin')
    const fixture = await createAutopayScopeFixture(request, token, 'tc-autopay-003', drainEventsQueue)

    try {
      const { scope, scheduleId } = fixture
      await configureAutopayIntegration(request, token, scope)
      const payment = await createAutopaySession(request, token, scope, 49.99)
      expect(payment.status).toBe('pending')

      const settled = (statusRequest: { orderId: string }) => ({
        status: 200,
        body: settledStatusXml(statusRequest.orderId, 49.99),
      })

      await makeAutopayScheduleDue(scheduleId)
      await runLocalSchedulerTick()
      const firstRun = await withAutopayStatusStub(settled, () => drainAutopayPollerQueue())
      expect(firstRun.requests.filter((entry) => entry.orderId === payment.sessionId)).toHaveLength(1)

      const afterFirstRun = await getTransactionDetails(request, token, scope, payment.transactionId)
      expect(afterFirstRun.transaction.unifiedStatus).toBe('captured')
      expect(afterFirstRun.transaction.lastPolledAt).not.toBeNull()
      const transitions = pollerTransitionLogs(afterFirstRun)
      expect(transitions, 'one canonical transition entry').toHaveLength(1)
      expect(transitions[0]).toMatchObject({
        level: 'info',
        payload: { previousStatus: 'pending', nextStatus: 'captured' },
      })

      await makeAutopayScheduleDue(scheduleId)
      await runLocalSchedulerTick()
      const secondRun = await withAutopayStatusStub(settled, () => drainAutopayPollerQueue())
      expect(
        secondRun.requests.filter((entry) => entry.orderId === payment.sessionId),
        'a captured payment is terminal and no longer polled',
      ).toHaveLength(0)

      const afterSecondRun = await getTransactionDetails(request, token, scope, payment.transactionId)
      expect(afterSecondRun.transaction.unifiedStatus).toBe('captured')
      expect(pollerTransitionLogs(afterSecondRun)).toHaveLength(1)
    } finally {
      await fixture.cleanup()
    }
  })
})
