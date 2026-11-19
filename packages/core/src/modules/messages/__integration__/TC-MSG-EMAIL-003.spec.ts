import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  clearCapturedSystemEmails,
  isChannelSeedingAvailable,
  seedSystemEmailChannel,
  waitForCapturedSystemEmail,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import { composeMessageWithToken, deleteMessageIfExists } from './helpers'

/**
 * TC-MSG-EMAIL-003 — a public message to several external addresses is delivered as
 * ONE system email whose "to" lists every address (joint send).
 */
test.describe('TC-MSG-EMAIL-003: joint send to multiple external recipients', () => {
  test('one captured email carries every "to" address', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const seedingAvailable = await isChannelSeedingAvailable(request, token)
    test.skip(!seedingAvailable, 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

    await seedSystemEmailChannel(request, token)
    await clearCapturedSystemEmails(request, token)

    const stamp = Date.now()
    const addresses = [1, 2, 3].map((index) => `qa-message-joint-${index}-${stamp}@example.test`)
    const subject = `QA joint external message ${stamp}`
    let messageId: string | null = null

    try {
      messageId = await composeMessageWithToken(request, token, {
        visibility: 'public',
        externalEmails: addresses,
        recipients: [],
        subject,
        body: 'Joint external delivery coverage.',
        sendViaEmail: true,
      })

      await drainIntegrationQueue('events')
      await drainIntegrationQueue('messages-email')

      const captured = await waitForCapturedSystemEmail(
        request,
        token,
        (email) => email.metadata?.subject === subject,
        { description: 'joint external message email' },
      )
      expect(captured.metadata?.to).toEqual(addresses)
    } finally {
      await deleteMessageIfExists(request, token, messageId)
    }
  })
})
