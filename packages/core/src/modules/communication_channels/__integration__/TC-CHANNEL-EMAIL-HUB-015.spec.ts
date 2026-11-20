import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  deleteChannelIfExists,
  inspectMessageChannelLinks,
  isChannelSeedingAvailable,
  listCapturedSystemEmails,
  seedConnectedChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import {
  isSchedulingAvailable,
  makeScheduledMessageDue,
  readMessageScheduleRow,
  runScheduledRelease,
  scheduledAtInMinutes,
  QA_RECIPIENTS,
  useRaisedExternalEmailBudget,
} from '@open-mercato/core/modules/messages/__integration__/scheduledSendFixtures'

/**
 * TC-CHANNEL-EMAIL-HUB-015 — the sender's mailbox needs re-authentication at release.
 *
 * The message is released (no revert loop), nothing is linked or sent, every
 * participant is `failed` with `mailbox unavailable`, and the author gets the
 * `messages.delivery_failed` notification.
 */
test.describe('TC-CHANNEL-EMAIL-HUB-015: mailbox requires reauth at release', () => {
  useRaisedExternalEmailBudget()
  test('fails the participants and notifies the author instead of sending', async ({ request }) => {
    test.slow()
    const stamp = Date.now()
    const recipient = QA_RECIPIENTS[0]
    const subject = `HUB-015 reauth ${stamp}`
    let token: string | null = null
    let channelId: string | null = null
    let messageId: string | null = null

    try {
      token = await getAuthToken(request)
      test.skip(!(await isChannelSeedingAvailable(request, token)), 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')
      test.skip(!(await isSchedulingAvailable(request, token)), 'scheduler module is not enabled')

      channelId = await seedConnectedChannel(request, token, {
        displayName: `HUB-015 ${stamp}`,
        externalIdentifier: `hub-015-${stamp}@example.com`,
      })

      const composeResponse = await apiRequest(request, 'POST', '/api/messages', {
        token,
        data: {
          visibility: 'public',
          externalEmail: recipient,
          recipients: [],
          subject,
          body: 'Scheduled through a mailbox that will lose its session.',
          sendViaEmail: true,
          senderChannelId: channelId,
          scheduledAt: scheduledAtInMinutes(30),
        },
      })
      expect(composeResponse.status()).toBe(201)
      messageId = (await readJsonSafe<{ id?: string }>(composeResponse))?.id ?? null
      expect(messageId).toBeTruthy()

      // No product API puts a seeded channel into requires_reauth; the provider sync does that in production.
      await withClient((client) => client.query(
        `update communication_channels set status = 'requires_reauth' where id = $1`,
        [channelId],
      ))

      await makeScheduledMessageDue(messageId as string)
      await runScheduledRelease(token)
      await drainIntegrationQueue('events')

      expect(await readMessageScheduleRow(messageId as string)).toMatchObject({ status: 'sent', is_draft: false })
      expect((await inspectMessageChannelLinks(request, token, messageId as string)).links).toHaveLength(0)
      expect((await listCapturedSystemEmails(request, token)).filter((email) => email.metadata?.subject === subject)).toHaveLength(0)

      const detailResponse = await apiRequest(request, 'GET', `/api/messages/${encodeURIComponent(messageId as string)}`, { token })
      expect(detailResponse.ok()).toBeTruthy()
      const detail = await readJsonSafe<{
        externalParticipants?: Array<{ email: string; deliveryStatus: string | null; deliveryError?: string | null }>
      }>(detailResponse)
      expect(detail?.externalParticipants ?? []).toEqual([
        expect.objectContaining({ email: recipient, deliveryStatus: 'failed', deliveryError: 'mailbox unavailable' }),
      ])

      const notifications = await withClient(async (client) => {
        const result = await client.query<{ count: string }>(
          `select count(*)::text as count from notifications where type = 'messages.delivery_failed' and source_entity_id = $1`,
          [messageId],
        )
        return Number(result.rows[0]?.count ?? 0)
      })
      expect(notifications, 'the author is notified once').toBe(1)
    } finally {
      if (token && messageId) {
        await apiRequest(request, 'DELETE', `/api/messages/${encodeURIComponent(messageId)}`, { token }).catch(() => {})
      }
      await deleteChannelIfExists(request, token, channelId)
    }
  })
})
