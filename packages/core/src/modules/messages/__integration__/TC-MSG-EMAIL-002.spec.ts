import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  clearCapturedSystemEmails,
  deleteChannelIfExists,
  ingestInboundEmailMessage,
  isChannelSeedingAvailable,
  listCapturedSystemEmails,
  seedConnectedChannel,
  seedSystemEmailChannel,
  waitForCapturedSystemEmail,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import { composeMessageWithToken, deleteMessageIfExists } from './helpers'

/**
 * TC-MSG-EMAIL-002 — an inbound channel email is never echoed to its sender.
 *
 * Regression for #6089: `messages.messages.compose` forced `sendViaEmail: true`
 * on every public message, overriding the explicit `false` that
 * `ingest_inbound_message` passes. The `messages.message.sent` subscriber then
 * queued an `external` email job addressed to the message's `externalEmail` —
 * which for an inbound message is the ORIGINAL SENDER — and, with a tenant
 * system email channel configured, every incoming email went back to its author.
 *
 * Both halves of the contract are proven in ONE run against the same configured
 * system channel, so the negative assertion cannot pass merely because delivery
 * was broken:
 *   1. a public `POST /api/messages` with `sendViaEmail: true` still reaches the
 *      Communications Hub system channel (positive control), and
 *   2. an email ingested through the REAL ingest command produces no system
 *      email at all, in particular none addressed to its sender.
 */
test.describe('TC-MSG-EMAIL-002: inbound channel email is not echoed to its sender', () => {
  test('ingested inbound email yields no external delivery while requested public delivery still sends', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const scope = getTokenScope(token)
    const seedingAvailable = await isChannelSeedingAvailable(request, token)
    test.skip(!seedingAvailable, 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

    await seedSystemEmailChannel(request, token)
    await clearCapturedSystemEmails(request, token)

    const stamp = Date.now()
    const inboundSender = `qa-inbound-sender-${stamp}@example.test`
    const inboundSubject = `QA inbound email ${stamp}`
    const outboundRecipient = `qa-outbound-recipient-${stamp}@example.test`
    const outboundSubject = `QA outbound public message ${stamp}`

    let channelId: string | null = null
    let inboundMessageId: string | null = null
    let outboundMessageId: string | null = null

    try {
      channelId = await seedConnectedChannel(request, token, {
        displayName: `TC-MSG-EMAIL-002 ${stamp}`,
        externalIdentifier: `tc-msg-email-002-${stamp}@test-seed.local`,
      })

      // (1) Inbound: the real ingest path — adapter.normalizeInbound → ingest command
      // → messages.messages.compose (visibility: public, sendViaEmail: false).
      const ingested = await ingestInboundEmailMessage(request, token, {
        channelId,
        senderAddress: inboundSender,
        senderDisplayName: 'QA Inbound Sender',
        subject: inboundSubject,
        body: 'Inbound email body for the echo regression.',
        externalMessageId: `<tc-msg-email-002-${stamp}@example.test>`,
        externalConversationId: `tc-msg-email-002-conversation-${stamp}`,
      })
      expect(ingested.status, 'the hub accepted the inbound email').toBe('created')
      inboundMessageId = ingested.messageId
      expect(inboundMessageId, 'ingest composed a platform message').toBeTruthy()

      // (2) Positive control: a user-composed public message that asks for email
      // delivery. If this one is not captured, the pipeline itself is broken and
      // the negative assertion below would be meaningless.
      outboundMessageId = await composeMessageWithToken(request, token, {
        visibility: 'public',
        externalEmail: outboundRecipient,
        recipients: [],
        subject: outboundSubject,
        body: 'Outbound public message body for the echo regression.',
        sendViaEmail: true,
      })

      await drainIntegrationQueue('events')
      await drainIntegrationQueue('messages-email')

      const control = await waitForCapturedSystemEmail(
        request,
        token,
        (email) => email.metadata?.to === outboundRecipient && email.metadata?.subject === outboundSubject,
        { description: 'requested public-message delivery through the system channel' },
      )
      expect(control.scope.tenantId).toBe(scope.tenantId)

      // (3) The assertion under test: nothing left the system channel for the
      // inbound message — neither to its sender nor under its subject.
      const captured = await listCapturedSystemEmails(request, token)
      const echoed = captured.filter(
        (email) => email.metadata?.to === inboundSender || email.metadata?.subject === inboundSubject,
      )
      expect(
        echoed,
        `inbound email must not be echoed to its sender; captured: ${JSON.stringify(
          captured.map((email) => ({ to: email.metadata?.to, subject: email.metadata?.subject })),
        )}`,
      ).toEqual([])
    } finally {
      await deleteMessageIfExists(request, token, outboundMessageId)
      await deleteMessageIfExists(request, token, inboundMessageId)
      await deleteChannelIfExists(request, token, channelId)
    }
  })
})
