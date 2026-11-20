import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  deleteChannelIfExists,
  inspectMessageChannelLinks,
  isChannelSeedingAvailable,
  listCapturedSystemEmails,
  seedConnectedChannel,
  waitForCapturedSystemEmail,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import {
  isSchedulingAvailable,
  makeScheduledMessageDue,
  readMessageScheduleRow,
  runScheduledRelease,
  scheduledAtInMinutes,
  QA_RECIPIENTS,
} from '@open-mercato/core/modules/messages/__integration__/scheduledSendFixtures'

/**
 * TC-CHANNEL-EMAIL-HUB-013 — scheduled message through the sender's own mailbox.
 *
 * Scheduling stores the mailbox on the message and creates no channel artefacts;
 * the release hands the message to the mailbox (one outbound link + thread
 * mapping) and the test-seed adapter delivers it exactly once.
 */
test.describe('TC-CHANNEL-EMAIL-HUB-013: scheduled mailbox message', () => {
  test('has no channel link before release and is delivered through the mailbox after', async ({ request }) => {
    test.slow()
    const stamp = Date.now()
    const recipient = QA_RECIPIENTS[0]
    const subject = `HUB-013 scheduled ${stamp}`
    let token: string | null = null
    let channelId: string | null = null
    let messageId: string | null = null

    try {
      token = await getAuthToken(request)
      test.skip(!(await isChannelSeedingAvailable(request, token)), 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')
      test.skip(!(await isSchedulingAvailable(request, token)), 'scheduler module is not enabled')

      channelId = await seedConnectedChannel(request, token, {
        displayName: `HUB-013 ${stamp}`,
        externalIdentifier: `hub-013-${stamp}@example.com`,
      })

      const composeResponse = await apiRequest(request, 'POST', '/api/messages', {
        token,
        data: {
          visibility: 'public',
          externalEmail: recipient,
          recipients: [],
          subject,
          body: 'Scheduled through my mailbox.',
          sendViaEmail: true,
          senderChannelId: channelId,
          scheduledAt: scheduledAtInMinutes(30),
        },
      })
      expect(composeResponse.status(), 'scheduling through a connected mailbox is accepted').toBe(201)
      messageId = (await readJsonSafe<{ id?: string }>(composeResponse))?.id ?? null
      expect(messageId).toBeTruthy()

      expect(await readMessageScheduleRow(messageId as string)).toMatchObject({ status: 'scheduled', sender_channel_id: channelId })
      const before = await inspectMessageChannelLinks(request, token, messageId as string)
      expect(before.links, 'no channel link before release').toHaveLength(0)
      expect(before.threadMappings).toHaveLength(0)

      await makeScheduledMessageDue(messageId as string)
      await runScheduledRelease(token)
      await drainIntegrationQueue('communication-channels-outbound')
      await drainIntegrationQueue('events')

      expect(await readMessageScheduleRow(messageId as string)).toMatchObject({ status: 'sent', is_draft: false })
      const after = await inspectMessageChannelLinks(request, token, messageId as string)
      expect(after.links, 'release creates one outbound link').toHaveLength(1)
      expect(after.threadMappings.length).toBeGreaterThan(0)

      const matches = (email: { metadata?: { subject?: unknown } }) => email.metadata?.subject === subject
      await waitForCapturedSystemEmail(request, token, matches, { description: 'released mailbox email' })
      expect((await listCapturedSystemEmails(request, token)).filter(matches)).toHaveLength(1)
    } finally {
      if (token && messageId) {
        await apiRequest(request, 'DELETE', `/api/messages/${encodeURIComponent(messageId)}`, { token }).catch(() => {})
      }
      await deleteChannelIfExists(request, token, channelId)
    }
  })
})
