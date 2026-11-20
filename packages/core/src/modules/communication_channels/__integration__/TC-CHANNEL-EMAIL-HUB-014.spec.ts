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
import { readMessageScheduleRow } from '@open-mercato/core/modules/messages/__integration__/scheduledSendFixtures'

/**
 * TC-CHANNEL-EMAIL-HUB-014 — a saved draft is sent through the sender's mailbox.
 *
 * Saving a draft keeps the chosen mailbox; sending the draft later (without
 * repeating the mailbox) goes through `sendAsUser` existing-message mode instead
 * of the former 422 and delivers the same message once.
 */
test.describe('TC-CHANNEL-EMAIL-HUB-014: saved draft sent via mailbox', () => {
  test('sends the stored draft through the mailbox it was saved with', async ({ request }) => {
    test.slow()
    const stamp = Date.now()
    const recipient = `hub-014-${stamp}@example.com`
    const subject = `HUB-014 draft ${stamp}`
    let token: string | null = null
    let channelId: string | null = null
    let messageId: string | null = null

    try {
      token = await getAuthToken(request)
      test.skip(!(await isChannelSeedingAvailable(request, token)), 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

      channelId = await seedConnectedChannel(request, token, {
        displayName: `HUB-014 ${stamp}`,
        externalIdentifier: `hub-014-${stamp}@example.com`,
      })

      const draftResponse = await apiRequest(request, 'POST', '/api/messages', {
        token,
        data: {
          visibility: 'public',
          externalEmail: recipient,
          recipients: [],
          subject,
          body: 'Draft sent later through my mailbox.',
          sendViaEmail: true,
          senderChannelId: channelId,
          isDraft: true,
        },
      })
      expect(draftResponse.status()).toBe(201)
      messageId = (await readJsonSafe<{ id?: string }>(draftResponse))?.id ?? null
      expect(messageId).toBeTruthy()
      expect(await readMessageScheduleRow(messageId as string)).toMatchObject({ status: 'draft', sender_channel_id: channelId })
      expect((await inspectMessageChannelLinks(request, token, messageId as string)).links).toHaveLength(0)

      const sendResponse = await apiRequest(request, 'PATCH', `/api/messages/${encodeURIComponent(messageId as string)}`, {
        token,
        data: { isDraft: false },
      })
      expect(sendResponse.status(), 'sending a saved draft through a mailbox succeeds').toBe(200)

      await drainIntegrationQueue('communication-channels-outbound')
      await drainIntegrationQueue('events')

      expect(await readMessageScheduleRow(messageId as string)).toMatchObject({ status: 'sent', is_draft: false })
      const inspected = await inspectMessageChannelLinks(request, token, messageId as string)
      expect(inspected.links, 'the draft itself is linked, no new message is composed').toHaveLength(1)

      const matches = (email: { metadata?: { subject?: unknown } }) => email.metadata?.subject === subject
      await waitForCapturedSystemEmail(request, token, matches, { description: 'draft sent through the mailbox' })
      expect((await listCapturedSystemEmails(request, token)).filter(matches)).toHaveLength(1)
    } finally {
      if (token && messageId) {
        await apiRequest(request, 'DELETE', `/api/messages/${encodeURIComponent(messageId)}`, { token }).catch(() => {})
      }
      await deleteChannelIfExists(request, token, channelId)
    }
  })
})
