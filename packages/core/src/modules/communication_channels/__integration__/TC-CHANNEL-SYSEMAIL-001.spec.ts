import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  clearCapturedSystemEmails,
  isChannelSeedingAvailable,
  listCapturedSystemEmails,
  queueSystemEmail,
  seedSystemEmailChannel,
  waitForCapturedSystemEmail,
  waitForSystemEmailDeliveryStatus,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

/**
 * TC-CHANNEL-SYSEMAIL-001 — queued system email delivery with retry.
 *
 * Drives the queued path (`OM_SYSTEM_EMAIL_DELIVERY=queued`) through the env-gated test-seed
 * endpoint: the email is persisted, delivered by the `system-email-delivery` worker through the
 * tenant's system channel, retried on a transient failure and closed on a permanent one. Content
 * columns must be purged in every terminal state.
 *
 * Spec: .ai/specs/2026-10-29-queued-system-email-delivery.md
 */
test.describe('TC-CHANNEL-SYSEMAIL-001: queued system email delivery', () => {
  test('delivers, retries a transient failure, and gives up on a permanent one', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = getTokenScope(token)
    const seedingAvailable = await isChannelSeedingAvailable(request, token)
    test.skip(!seedingAvailable, 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

    await seedSystemEmailChannel(request, token)
    await clearCapturedSystemEmails(request, token)
    const stamp = Date.now()

    const deliveredSubject = `Queued system email ${stamp}`
    const deliveredId = await queueSystemEmail(request, token, {
      to: `qa-sysemail-ok-${stamp}@example.com`,
      subject: deliveredSubject,
      text: 'Queued delivery body',
    })
    const delivered = await waitForSystemEmailDeliveryStatus(request, token, deliveredId, 'sent')
    expect(delivered.attempts).toBe(1)
    expect(delivered.hasContent).toBe(false)
    const capturedEmail = await waitForCapturedSystemEmail(
      request,
      token,
      (email) => email.metadata?.subject === deliveredSubject,
      { description: 'queued system email' },
    )
    expect(capturedEmail.scope.tenantId).toBe(scope.tenantId)

    const retriedSubject = `Queued retry ${stamp} [test-seed:fail-transient-once]`
    const retriedId = await queueSystemEmail(request, token, {
      to: `qa-sysemail-retry-${stamp}@example.com`,
      subject: retriedSubject,
      text: 'Queued retry body',
    })
    const retried = await waitForSystemEmailDeliveryStatus(request, token, retriedId, 'sent')
    expect(retried.attempts).toBe(2)
    expect(retried.hasContent).toBe(false)
    await waitForCapturedSystemEmail(
      request,
      token,
      (email) => email.metadata?.subject === retriedSubject,
      { description: 'retried system email' },
    )

    const rejectedSubject = `Queued rejection ${stamp} [test-seed:fail-permanent]`
    const rejectedId = await queueSystemEmail(request, token, {
      to: `qa-sysemail-rejected-${stamp}@example.com`,
      subject: rejectedSubject,
      text: 'Queued rejection body',
    })
    const rejected = await waitForSystemEmailDeliveryStatus(request, token, rejectedId, 'failed')
    expect(rejected.attempts).toBe(1)
    expect(rejected.hasContent).toBe(false)
    expect(rejected.lastError).toContain('rejected')
    const captured = await listCapturedSystemEmails(request, token)
    expect(captured.some((email) => email.metadata?.subject === rejectedSubject)).toBe(false)
  })
})
