import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  AUTOPAY_INTEGRATION_TEST_TIMEOUT_MS,
  configureAutopayIntegration,
  createAutopayScopeFixture,
  createAutopaySession,
  getTransactionDetails,
  listStatusPollFailureLogs,
  makeAutopayScheduleDue,
} from './helpers/fixtures'
import { foreignKeyStatusXml, settledStatusXml } from './helpers/provider-responses'
import {
  drainAutopayPollerQueue,
  drainEventsQueue,
  requireInProcessPollerLane,
  runLocalSchedulerTick,
  withAutopayStatusStub,
  type AutopayStatusResponder,
} from './helpers/runtime'

/**
 * TC-AUTOPAY-004: A provider error leaves the payment pending and the next run retries
 *
 * An HTTP 500 from `transactionStatus` keeps the payment `pending` and writes one
 * integration log entry with code `payment_gateways.status_poll_failed`. The next
 * scheduler run polls the same payment again; a response signed with a foreign key is
 * rejected at hash verification and logged the same way. Once the provider answers a
 * correctly signed `SUCCESS`, the payment is captured.
 */
test.describe('TC-AUTOPAY-004: provider error isolation and retry', () => {
  test('logs a failed poll, retries on the next run and recovers once the provider answers', async ({ request }) => {
    test.setTimeout(AUTOPAY_INTEGRATION_TEST_TIMEOUT_MS)
    requireInProcessPollerLane()

    const token = await getAuthToken(request, 'superadmin')
    const fixture = await createAutopayScopeFixture(request, token, 'tc-autopay-004', drainEventsQueue)

    try {
      const { scope, scheduleId } = fixture
      await configureAutopayIntegration(request, token, scope)
      const payment = await createAutopaySession(request, token, scope, 30)
      expect(payment.status).toBe('pending')

      const runCycle = async (responder: AutopayStatusResponder) => {
        await makeAutopayScheduleDue(scheduleId)
        await runLocalSchedulerTick()
        const run = await withAutopayStatusStub(responder, () => drainAutopayPollerQueue())
        return run.requests.filter((entry) => entry.orderId === payment.sessionId)
      }

      const serverErrorRequests = await runCycle(() => ({ status: 500, body: 'upstream failure' }))
      expect(serverErrorRequests).toHaveLength(1)

      const afterServerError = await getTransactionDetails(request, token, scope, payment.transactionId)
      expect(afterServerError.transaction.unifiedStatus).toBe('pending')
      expect(afterServerError.transaction.lastPolledAt, 'a failed poll still records the attempt').not.toBeNull()

      const failuresAfterServerError = await listStatusPollFailureLogs(request, token, scope, payment.transactionId)
      expect(failuresAfterServerError).toHaveLength(1)
      expect(failuresAfterServerError[0]).toMatchObject({
        integrationId: 'gateway_autopay',
        scopeEntityType: 'payment_transaction',
        scopeEntityId: payment.transactionId,
        level: 'error',
        code: 'payment_gateways.status_poll_failed',
        payload: { transactionId: payment.transactionId },
      })
      expect(failuresAfterServerError[0].message).toContain('HTTP 500')

      const foreignKeyRequests = await runCycle((statusRequest) => ({
        status: 200,
        body: foreignKeyStatusXml(statusRequest.orderId, 30),
      }))
      expect(foreignKeyRequests, 'the next run retries the still-pending payment').toHaveLength(1)

      const afterForeignKey = await getTransactionDetails(request, token, scope, payment.transactionId)
      expect(afterForeignKey.transaction.unifiedStatus, 'a response signed with a foreign key is rejected').toBe('pending')
      const failuresAfterForeignKey = await listStatusPollFailureLogs(request, token, scope, payment.transactionId)
      expect(failuresAfterForeignKey).toHaveLength(2)
      expect(failuresAfterForeignKey.some((entry) => /hash verification/i.test(entry.message))).toBe(true)

      const recoveryRequests = await runCycle((statusRequest) => ({
        status: 200,
        body: settledStatusXml(statusRequest.orderId, 30),
      }))
      expect(recoveryRequests).toHaveLength(1)

      const afterRecovery = await getTransactionDetails(request, token, scope, payment.transactionId)
      expect(afterRecovery.transaction.unifiedStatus).toBe('captured')
      expect(await listStatusPollFailureLogs(request, token, scope, payment.transactionId)).toHaveLength(2)
    } finally {
      await fixture.cleanup()
    }
  })
})
