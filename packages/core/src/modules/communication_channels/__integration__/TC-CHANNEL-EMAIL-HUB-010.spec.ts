import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { expect, test } from '@playwright/test'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  deleteChannelIfExists,
  ingestInboundEmailMessage,
  inspectMessageChannelLinks,
  isChannelSeedingAvailable,
  listCapturedSystemEmails,
  seedConnectedChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import { QA_RECIPIENTS } from '@open-mercato/core/modules/messages/__integration__/scheduledSendFixtures'

/**
 * TC-CHANNEL-EMAIL-HUB-010 — "send separately" through a connected mailbox.
 *
 * `POST /api/communication_channels/send-as-user` with `sendSeparately: true`
 * and two "to" addresses must create one outbound link per recipient, deliver
 * one email per recipient (each addressed to that recipient only), mark both
 * participants `sent`, and a reply from the second recipient must thread onto
 * the original message.
 */

const APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
  ? path.resolve(process.env.OM_TEST_APP_ROOT as string)
  : path.resolve(process.cwd(), 'apps/mercato')

if (!process.env.OM_TEST_APP_ROOT?.trim()) {
  loadEnv({ path: path.resolve(APP_ROOT, '.env') })
  if (!process.env.QUEUE_BASE_DIR?.trim()) {
    process.env.QUEUE_BASE_DIR = path.resolve(APP_ROOT, '.mercato/queue')
  }
}

async function drainUntil(check: () => Promise<boolean>, label: string): Promise<void> {
  const shouldDrainQueues = parseBooleanToken(process.env.AUTO_SPAWN_WORKERS) !== true
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (shouldDrainQueues) {
      await drainIntegrationQueue('communication-channels-outbound', { appRoot: APP_ROOT })
      await drainIntegrationQueue('events', { appRoot: APP_ROOT })
    }
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

type MessageDetail = {
  emailSendSeparately?: boolean
  externalParticipants?: Array<{ role: string; email: string; deliveryStatus: string | null }>
}

test.describe('TC-CHANNEL-EMAIL-HUB-010: send separately through a mailbox', () => {
  test('creates one link and one delivery per recipient, and a recipient reply threads onto the message', async ({ request }) => {
    const stamp = Date.now()
    const firstRecipient = QA_RECIPIENTS[0]
    const secondRecipient = QA_RECIPIENTS[1]
    const subject = `HUB-010 separate ${stamp}`
    let token: string | null = null
    let channelId: string | null = null

    try {
      token = await getAuthToken(request)
      const seedingAvailable = await isChannelSeedingAvailable(request, token)
      test.skip(!seedingAvailable, 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled; cannot provision a connected channel.')

      channelId = await seedConnectedChannel(request, token, {
        displayName: `HUB-010 mailbox ${stamp}`,
        externalIdentifier: `hub-010-${stamp}@example.com`,
      })

      const sendResponse = await apiRequest(request, 'POST', '/api/communication_channels/send-as-user', {
        token,
        data: {
          userChannelId: channelId,
          to: [firstRecipient, secondRecipient],
          subject,
          body: { plain: 'One copy per recipient.' },
          sendSeparately: true,
        },
      })
      expect(sendResponse.status(), 'a separate send without copies is accepted').toBe(202)
      const sent = await readJsonSafe<{ messageId?: string; threadId?: string }>(sendResponse)
      const messageId = sent?.messageId as string
      const threadId = sent?.threadId as string
      expect(messageId).toBeTruthy()
      expect(threadId).toBeTruthy()

      const inspected = await inspectMessageChannelLinks(request, token, messageId)
      expect(inspected.links.filter((link) => link.direction === 'outbound'), 'one outbound link per recipient').toHaveLength(2)

      await drainUntil(async () => {
        const current = await inspectMessageChannelLinks(request, token as string, messageId)
        return current.links.length === 2 && current.links.every((link) => link.deliveryStatus === 'sent')
      }, 'both separate links to be sent')

      const captured = (await listCapturedSystemEmails(request, token)).filter(
        (item) => item.metadata?.subject === subject,
      )
      expect(captured, 'one captured send per recipient').toHaveLength(2)
      expect(captured.map((item) => item.metadata?.to).sort()).toEqual([[firstRecipient], [secondRecipient]].sort())
      for (const item of captured) {
        expect(item.metadata?.cc ?? []).toEqual([])
        expect(item.metadata?.bcc ?? []).toEqual([])
      }

      const detailResponse = await apiRequest(request, 'GET', `/api/messages/${encodeURIComponent(messageId)}`, { token })
      expect(detailResponse.ok()).toBeTruthy()
      const detail = await readJsonSafe<MessageDetail>(detailResponse)
      expect(detail?.emailSendSeparately).toBe(true)
      expect(
        (detail?.externalParticipants ?? []).map((participant) => [participant.role, participant.email, participant.deliveryStatus]).sort(),
      ).toEqual([
        ['to', firstRecipient, 'sent'],
        ['to', secondRecipient, 'sent'],
      ].sort())

      const reply = await ingestInboundEmailMessage(request, token, {
        channelId,
        senderAddress: secondRecipient,
        subject: `Re: ${subject}`,
        body: 'Reply from the second recipient.',
        externalMessageId: `hub-010-reply-${stamp}@example.com`,
        externalConversationId: `outbound:${threadId}`,
      })
      expect(reply.messageId, 'the inbound reply is ingested').toBeTruthy()
      const replyThreadId = await withClient(async (client) => {
        const result = await client.query<{ thread_id: string | null }>(
          'select thread_id from messages where id = $1',
          [reply.messageId],
        )
        return result.rows[0]?.thread_id ?? null
      })
      expect(replyThreadId, 'the reply from the second recipient threads onto the original message').toBe(threadId)
    } finally {
      await deleteChannelIfExists(request, token, channelId)
    }
  })
})
