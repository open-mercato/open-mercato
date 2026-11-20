import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  clearCapturedSystemEmails,
  isChannelSeedingAvailable,
  listCapturedSystemEmails,
  seedSystemEmailChannel,
  waitForCapturedSystemEmail,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import { composeMessageWithToken, deleteMessageIfExists } from './helpers'
import { isSchedulingAvailable, makeScheduledMessageDue, runScheduledRelease, scheduledAtInMinutes, useRaisedExternalEmailBudget } from './scheduledSendFixtures'
import { QA_RECIPIENTS } from './scheduledSendFixtures'

/**
 * TC-MSG-EMAIL-005: a scheduled external message on the system transport sends no
 * email before release and exactly one after the release worker runs.
 */
test.describe('TC-MSG-EMAIL-005: scheduled external email on the system transport', () => {
  useRaisedExternalEmailBudget()
  test('captures nothing before release and one email after', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    test.skip(!(await isChannelSeedingAvailable(request, token)), 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')
    test.skip(!(await isSchedulingAvailable(request, token)), 'scheduler module is not enabled')

    await seedSystemEmailChannel(request, token)
    await clearCapturedSystemEmails(request, token)

    const stamp = Date.now()
    const externalEmail = QA_RECIPIENTS[0]
    const subject = `QA TC-MSG-EMAIL-005 ${stamp}`
    const matches = (email: { metadata?: { to?: unknown; subject?: unknown } }) =>
      email.metadata?.to === externalEmail && email.metadata?.subject === subject
    let messageId: string | null = null

    try {
      messageId = await composeMessageWithToken(request, token, {
        visibility: 'public',
        externalEmail,
        recipients: [],
        subject,
        body: 'Scheduled external body.',
        sendViaEmail: true,
        scheduledAt: scheduledAtInMinutes(30),
      })

      await drainIntegrationQueue('events')
      await drainIntegrationQueue('messages-email')
      expect((await listCapturedSystemEmails(request, token)).filter(matches)).toHaveLength(0)

      await makeScheduledMessageDue(messageId)
      await runScheduledRelease(token)
      await drainIntegrationQueue('messages-email')

      await waitForCapturedSystemEmail(request, token, matches, { description: 'released scheduled email' })
      expect((await listCapturedSystemEmails(request, token)).filter(matches)).toHaveLength(1)
    } finally {
      await deleteMessageIfExists(request, token, messageId)
    }
  })
})
