import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createNotificationFixture,
  dismissNotificationIfExists,
} from '@open-mercato/core/helpers/integration/notificationsFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  clearCapturedSystemEmails,
  isChannelSeedingAvailable,
  seedSystemEmailChannel,
  waitForCapturedSystemEmail,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

test.describe('TC-NOTIF-EMAIL-001: Notification email uses system channel', () => {
  test('notification created event dispatches email through Communications Hub', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = getTokenScope(token)
    const seedingAvailable = await isChannelSeedingAvailable(request, token)
    test.skip(!seedingAvailable, 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

    await seedSystemEmailChannel(request, token)
    await clearCapturedSystemEmails(request, token)

    const stamp = Date.now()
    const title = `QA notification email ${stamp}`
    let notificationId: string | null = null

    try {
      notificationId = await createNotificationFixture(request, token, {
        type: `qa.notifications.email.${stamp}`,
        title,
        body: 'Notification email integration body',
        recipientUserId: scope.userId,
      })

      await drainIntegrationQueue('events')

      const captured = await waitForCapturedSystemEmail(
        request,
        token,
        (email) => email.metadata?.to === 'admin@acme.com' && email.metadata?.subject === title,
        { description: 'notification delivery email' },
      )
      expect(String(captured.metadata?.from ?? '')).toContain('@')
      expect(captured.scope.tenantId).toBe(scope.tenantId)
      expect(captured.scope.organizationId).toBeTruthy()
      expect(captured.scope.organizationId).not.toBe('system')
      expect(captured.content.bodyFormat).toBe('html')
    } finally {
      await dismissNotificationIfExists(request, token, notificationId)
    }
  })
})
