import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  deleteChannelIfExists,
  ingestInboundChatMessage,
  isChannelSeedingAvailable,
  seedConnectedChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

/**
 * TC-CHANNEL-REPLY-001 — an operator can read and answer an inbound channel
 * message, and the answer is queued for delivery back to the channel.
 * Source: https://github.com/open-mercato/open-mercato/issues/5535
 *
 * The defect this pins was invisible to every existing test because it only
 * appears on a message the platform did not author: the ingest attributes the
 * message to the channel system user and, on an unassigned conversation, writes
 * no `message_recipients` row, so `messages`' sender-or-recipient predicate was
 * false for every operator by construction — a tenant admin included.
 *
 * Three assertions, in the order an operator hits them:
 *   1. `GET /api/messages/{id}` — the detail page the reply button lives on.
 *   2. `POST /api/messages/{id}/reply` — 403 for everyone before the fix.
 *   3. the outbound `MessageChannelLink`, proving the answer was actually routed
 *      back to the channel rather than filed as an internal message.
 *
 * Driven via the env-gated test-seed fixture (`OM_ENABLE_TEST_CHANNEL_SEEDING`)
 * and the REAL `ingest_inbound_message` command, so nothing about the message
 * under test is short-circuited; skips when the gate is off.
 */
const APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
  ? path.resolve(process.env.OM_TEST_APP_ROOT as string)
  : path.resolve(process.cwd(), 'apps/mercato')

if (!process.env.OM_TEST_APP_ROOT?.trim()) {
  loadEnv({ path: path.resolve(APP_ROOT, '.env') })
  process.env.QUEUE_BASE_DIR = path.resolve(APP_ROOT, '.mercato/queue')
}

const EVENTS_QUEUE = 'events'
const OUTBOUND_QUEUE = 'communication-channels-outbound'

/**
 * The outbound path is asynchronous: `messages.message.sent` reaches the bridge
 * through the events queue, which enqueues the delivery job. Drain both, then
 * re-read the channel's health totals until the outbound record shows up.
 */
async function drainUntilOutbound(
  request: APIRequestContext,
  token: string,
  channelId: string,
  expectedTotal: number,
): Promise<number> {
  const deadline = Date.now() + 30_000
  let lastTotal = 0
  while (Date.now() < deadline) {
    await drainIntegrationQueue(EVENTS_QUEUE, { appRoot: APP_ROOT })
    await drainIntegrationQueue(OUTBOUND_QUEUE, { appRoot: APP_ROOT })
    const healthResponse = await apiRequest(
      request,
      'GET',
      `/api/communication_channels/channels/${channelId}/health`,
      { token },
    )
    if (healthResponse.ok()) {
      const health = await readJsonSafe<{ totalsLast24h?: number }>(healthResponse)
      lastTotal = health?.totalsLast24h ?? 0
      if (lastTotal >= expectedTotal) return lastTotal
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return lastTotal
}

test.describe('TC-CHANNEL-REPLY-001: answering an inbound channel message', () => {
  test('reads, replies to and delivers an answer on a channel-linked thread', async ({
    request,
  }) => {
    test.slow()
    let token: string | null = null
    let channelId: string | null = null
    try {
      token = await getAuthToken(request, 'admin')
      const seedingAvailable = await isChannelSeedingAvailable(request, token)
      test.skip(
        !seedingAvailable,
        'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot connect a channel.',
      )

      const stamp = Date.now()
      channelId = await seedConnectedChannel(request, token, {
        displayName: `TC-CHANNEL-REPLY-001 ${stamp}`,
        providerFlavor: 'chat',
      })

      const ingested = await ingestInboundChatMessage(request, token, {
        channelId,
        senderIdentifier: `chat-user-${stamp}`,
        senderDisplayName: 'Karol Kapsa',
        body: 'is anyone there?',
        externalMessageId: `chat-message-${stamp}`,
        externalConversationId: `chat-conversation-${stamp}`,
      })
      expect(ingested.status, 'the hub must accept the inbound message').toBe('created')
      const inboundMessageId = ingested.messageId
      expect(inboundMessageId, 'a platform message must have been composed').toBeTruthy()

      // (1) The detail page the reply button lives on. Before #5535 this was a
      // 403: the operator is neither the sender (the channel system user) nor a
      // recipient (there is none on an unassigned conversation).
      const detailResponse = await apiRequest(
        request,
        'GET',
        `/api/messages/${inboundMessageId}?skipMarkRead=1`,
        { token },
      )
      expect(
        detailResponse.status(),
        'an operator must be able to open an inbound channel message',
      ).toBe(200)
      const detail = await readJsonSafe<{ thread?: Array<{ id?: string }> }>(detailResponse)
      expect(
        (detail?.thread ?? []).map((item) => item.id),
        'the whole channel conversation must be visible, not only the operator own messages',
      ).toContain(inboundMessageId)

      // (2) The reply itself — the wall the issue reports.
      const replyResponse = await apiRequest(
        request,
        'POST',
        `/api/messages/${inboundMessageId}/reply`,
        { token, data: { body: 'yes, we are here', bodyFormat: 'text' } },
      )
      expect(
        replyResponse.status(),
        'an operator must be able to answer an inbound channel message',
      ).toBe(201)
      const reply = await readJsonSafe<{ id?: string }>(replyResponse)
      expect(reply?.id, 'the reply must have been persisted').toBeTruthy()

      // (3) Delivery. One inbound record plus one outbound record for the answer;
      // a reply that was filed as an internal message would leave the total at 1.
      const total = await drainUntilOutbound(request, token, channelId, 2)
      expect(
        total,
        'the answer must be routed back to the channel, not filed as an internal message',
      ).toBeGreaterThanOrEqual(2)
    } finally {
      await deleteChannelIfExists(request, token, channelId)
    }
  })
})
