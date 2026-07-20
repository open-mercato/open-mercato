import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createNotificationFixture } from '@open-mercato/core/helpers/integration/notificationsFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  connectFakePushChannel,
  deleteChannelIfExists,
  deleteDeliveriesForDevice,
  deleteFakePushDevice,
  isDeviceSoftDeleted,
  makeFakePushTokenFor,
  readLatestDelivery,
  registerFakePushDevice,
} from '@open-mercato/core/helpers/integration/pushFake'

/**
 * TC-PUSH-005 — a retryable provider error is retried to `MAX_ATTEMPTS` and then expires.
 *
 * `expired` (retries exhausted) is a distinct terminal state from `failed` (permanent error), and the
 * device must survive: a transient provider outage must never soft-delete a user's device.
 *
 * Each attempt re-enqueues with exponential backoff + jitter (~1-2s, then ~2-3s), so a single drain can
 * only ever advance one attempt — the terminal state is unreachable without draining across the delays.
 */
const PROVIDER = 'fcm'
const MAX_ATTEMPTS = 3

test.describe('TC-PUSH-005: retryable failure → MAX_ATTEMPTS → expired', () => {
  test('retries a transient provider error to exhaustion without deactivating the device', async ({ request }) => {
    // `test.slow()` only triples the config's 20s budget (→ 60s), which the 60s poll below alone
    // would consume — leaving nothing for setup, so the test always died before the poll could
    // reach its own deadline. Budget the whole test explicitly instead.
    test.setTimeout(120_000)
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, userId } = getTokenScope(adminToken)
    const { pushToken } = makeFakePushTokenFor(PROVIDER, 'fail')

    let channelId: string | null = null
    let userDeviceId: string | null = null
    try {
      channelId = await connectFakePushChannel(request, adminToken, PROVIDER, 'TC-PUSH-005 FCM')
      // `fail` in the token makes the fake SDK client throw an error with no `code`, so the adapter
      // classifies it as retryable rather than a permanent token error.
      userDeviceId = await registerFakePushDevice(
        request,
        adminToken,
        PROVIDER,
        pushToken,
        `qa-tc-push-005-${Date.now()}`,
      )

      await createNotificationFixture(request, adminToken, {
          recipientUserId: userId,
          type: 'admin.custom_message',
          title: 'TC-PUSH-005',
          body: 'Drives the retry branch.',
        })

      await drainIntegrationQueue('events')

      // One drain advances at most one attempt, and each re-enqueue is delayed by backoff. Drain
      // repeatedly until the row goes terminal or we run out of budget.
      await expect
        .poll(
          async () => {
            await drainIntegrationQueue('push-deliveries')
            return (await readLatestDelivery(tenantId, userDeviceId as string))?.status ?? null
          },
          { timeout: 60_000, intervals: [1_000] },
        )
        .toBe('expired')

      const row = await readLatestDelivery(tenantId, userDeviceId as string)
      expect(row?.attempts).toBe(MAX_ATTEMPTS)
      expect(row?.sent_at).toBeNull()
      expect(row?.last_error).toBeTruthy()
      // A transient failure is not a token verdict — the device must remain active.
      expect(await isDeviceSoftDeleted(userDeviceId as string)).toBe(false)
    } finally {
      await deleteDeliveriesForDevice(userDeviceId)
      await deleteFakePushDevice(request, adminToken, userDeviceId)
      await deleteChannelIfExists(request, adminToken, channelId)
    }
  })
})
