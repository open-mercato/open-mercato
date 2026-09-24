import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  deleteChannelIfExists,
  ingestInboundChatMessage,
  isChannelSeedingAvailable,
  seedConnectedChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

/**
 * TC-CHANNEL-REPLY-002 — the negative half of the channel-thread boundary
 * TC-CHANNEL-REPLY-001 opens: an operator who holds every `messages` feature but
 * no access to the channel behind the thread is refused on all three routes that
 * consult the channel-thread facade.
 * Source: https://github.com/open-mercato/open-mercato/issues/5535
 *
 * #5535 widened three participant tests with a channel-access fallback. Unit
 * suites pin the denials against a mocked facade; only an integration run drives
 * the real `assertCanAccessChannel` against a real channel row, and only here is
 * the actor a second, genuinely unprivileged session rather than a mocked
 * feature array. The seeded channel is a **personal mailbox owned by the admin**
 * who seeds it, so the second operator is a non-owner by construction — the one
 * shape `assertCanAccessChannel` refuses.
 *
 * Three refusals, mirroring TC-CHANNEL-REPLY-001's three grants:
 *   1. `GET /api/messages/{id}` — the fallback is feature-gated AND access-gated;
 *      holding `messages.view` is not enough to read another mailbox's thread.
 *   2. `POST /api/messages/{id}/reply` — the reply guard's channel fallback.
 *   3. `POST /api/messages` with an explicit `parentMessageId` — the compose path
 *      that reaches the thread without naming the conversation. It bypassed the
 *      gate entirely until the review of this PR; a tenant-wide channel accepts
 *      delivery from any sender, so `messages.compose` plus a known message id
 *      was enough to have the platform send on that channel's behalf.
 *
 * The admin's own 200 on the same message closes the loop: the refusals are
 * about who is asking, not about a broken fixture.
 *
 * Driven via the env-gated test-seed fixture (`OM_ENABLE_TEST_CHANNEL_SEEDING`)
 * and the REAL `ingest_inbound_message` command; skips when the gate is off.
 */
const APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
  ? path.resolve(process.env.OM_TEST_APP_ROOT as string)
  : path.resolve(process.cwd(), 'apps/mercato')

if (!process.env.OM_TEST_APP_ROOT?.trim()) {
  loadEnv({ path: path.resolve(APP_ROOT, '.env') })
  process.env.QUEUE_BASE_DIR = path.resolve(APP_ROOT, '.mercato/queue')
}

const OPERATOR_PASSWORD = 'Valid1!Pass'

test.describe('TC-CHANNEL-REPLY-002: an operator without channel access is refused', () => {
  test('refuses read, reply and parent-threaded compose on someone else mailbox thread', async ({
    request,
  }) => {
    test.slow()
    let adminToken: string | null = null
    let channelId: string | null = null
    let roleId: string | null = null
    let operatorUserId: string | null = null
    try {
      adminToken = await getAuthToken(request, 'admin')
      const seedingAvailable = await isChannelSeedingAvailable(request, adminToken)
      test.skip(
        !seedingAvailable,
        'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled in this environment; cannot connect a channel.',
      )

      const stamp = Date.now()
      const { organizationId, tenantId } = getTokenContext(adminToken)
      const operatorEmail = `qa-tc-channel-reply-002-${stamp}@test.invalid`

      // Every `messages` feature the three routes gate on, so a refusal can only
      // come from the channel-access decision itself.
      roleId = await createRoleFixture(request, adminToken, {
        name: `qa-tc-channel-reply-002-${stamp}`,
        tenantId,
      })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: ['messages.view', 'messages.compose', 'messages.email'],
        organizations: [organizationId],
      })
      operatorUserId = await createUserFixture(request, adminToken, {
        email: operatorEmail,
        password: OPERATOR_PASSWORD,
        organizationId,
        roles: [roleId],
        name: 'QA TC-CHANNEL-REPLY-002 Operator',
      })
      const operatorToken = await getAuthToken(request, operatorEmail, OPERATOR_PASSWORD)

      // Seeded as admin, so the channel is a personal mailbox the operator does
      // not own — `assertCanAccessChannel`'s owner-only branch.
      channelId = await seedConnectedChannel(request, adminToken, {
        displayName: `TC-CHANNEL-REPLY-002 ${stamp}`,
        providerFlavor: 'chat',
      })

      const ingested = await ingestInboundChatMessage(request, adminToken, {
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

      // Control: the channel owner still reaches the message, so everything below
      // fails on the actor and not on the fixture.
      const ownerDetail = await apiRequest(
        request,
        'GET',
        `/api/messages/${inboundMessageId}?skipMarkRead=1`,
        { token: adminToken },
      )
      expect(
        ownerDetail.status(),
        'the channel owner must still be able to open the inbound message',
      ).toBe(200)

      // (1) Reading the thread.
      const operatorDetail = await apiRequest(
        request,
        'GET',
        `/api/messages/${inboundMessageId}?skipMarkRead=1`,
        { token: operatorToken },
      )
      expect(
        operatorDetail.status(),
        'messages.view must not open another operator personal mailbox thread',
      ).toBe(403)

      // (2) Replying on the thread.
      const operatorReply = await apiRequest(
        request,
        'POST',
        `/api/messages/${inboundMessageId}/reply`,
        { token: operatorToken, data: { body: 'answering on your channel', bodyFormat: 'text' } },
      )
      expect(
        operatorReply.status(),
        'messages.compose must not answer on a channel the caller may not act on',
      ).toBe(403)

      // (3) Composing onto the same thread by naming the parent explicitly — the
      // path that reached delivery without a channel check before the review of
      // this PR.
      const operatorCompose = await apiRequest(request, 'POST', '/api/messages', {
        token: operatorToken,
        data: {
          visibility: 'public',
          parentMessageId: inboundMessageId,
          subject: 'Re: is anyone there?',
          body: 'threading onto your channel',
          bodyFormat: 'text',
          recipients: [],
        },
      })
      expect(
        operatorCompose.status(),
        'naming the parent message must not bypass the channel-access gate',
      ).toBe(403)
      const composeError = await readJsonSafe<{ error?: string }>(operatorCompose)
      expect(
        composeError?.error,
        'the refusal must come from the channel gate, not from a missing messages feature',
      ).toBe('Access denied')
    } finally {
      await deleteUserIfExists(request, adminToken, operatorUserId)
      await deleteRoleIfExists(request, adminToken, roleId)
      await deleteChannelIfExists(request, adminToken, channelId)
    }
  })
})
