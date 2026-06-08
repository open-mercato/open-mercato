import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  clearCapturedSystemEmails,
  isChannelSeedingAvailable,
  seedSystemEmailChannel,
  waitForCapturedSystemEmail,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import { composeMessageWithToken, deleteMessageIfExists } from './helpers'

test.describe('TC-MSG-EMAIL-001: Message external email uses system channel', () => {
  test('public compose with external delivery dispatches through Communications Hub', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = getTokenScope(token)
    const seedingAvailable = await isChannelSeedingAvailable(request, token)
    test.skip(!seedingAvailable, 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

    await seedSystemEmailChannel(request, token)
    await clearCapturedSystemEmails(request, token)

    const stamp = Date.now()
    const externalEmail = `qa-message-external-${stamp}@example.test`
    const subject = `QA external message email ${stamp}`
    let messageId: string | null = null

    try {
      messageId = await composeMessageWithToken(request, token, {
        visibility: 'public',
        externalEmail,
        recipients: [],
        subject,
        body: 'External message body for email integration coverage.',
        sendViaEmail: true,
      })

      await drainIntegrationQueue('events')
      await drainIntegrationQueue('messages-email')

      const captured = await waitForCapturedSystemEmail(
        request,
        token,
        (email) => email.metadata?.to === externalEmail && email.metadata?.subject === subject,
        { description: 'messages external email' },
      )
      expect(String(captured.metadata?.from ?? '')).toContain('@')
      expect(captured.scope.tenantId).toBe(scope.tenantId)
      expect(captured.scope.organizationId).toBe(scope.organizationId)
      expect(captured.content.bodyFormat).toBe('html')
    } finally {
      await deleteMessageIfExists(request, token, messageId)
    }
  })
})
