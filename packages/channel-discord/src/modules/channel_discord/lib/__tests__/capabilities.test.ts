import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto'
import { discordCapabilities, DISCORD_MAX_BODY_LENGTH } from '../capabilities'
import { getDiscordRestClient } from '../discord-rest'
import { convertOutboundForDiscord } from '../convert-outbound'
import { buildInteractionInboundJob, sendInteractionFollowUp } from '../interactions-dispatch'
import { handleDiscordInteraction } from '../interactions-handler'
import { DiscordInteractionResponseType, DiscordInteractionType } from '../interactions-verify'

function makeSigner() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer
  return {
    publicKeyHex: spki.subarray(spki.length - 32).toString('hex'),
    sign: (message: string) => cryptoSign(null, Buffer.from(message, 'utf-8'), privateKey).toString('hex'),
  }
}

/**
 * The hub routes work to the adapter based on these flags, so a capability that
 * nothing implements is not cosmetic — it makes the hub hand this provider work
 * it silently drops. Each assertion below is pinned to the code that would have
 * to land before the flag may flip.
 */
describe('discordCapabilities honesty', () => {
  it('declares provider-native recipients, because a Discord recipient is never an address', () => {
    // Found in QA of #4391 against a live bot: with this absent the hub falls
    // back to its `'email'` default and `validateOutboundRecipient` answers
    // `422 Recipient must be a valid email address` for a genuine channel
    // snowflake — #4976 still broken for the provider it was filed against,
    // even though #5261 had already built the mechanism that fixes it. Nothing
    // else in the repository declared `'provider-native'`, so that branch was
    // unreachable in production and only its unit tests exercised it.
    expect(discordCapabilities.recipientFormat).toBe('provider-native')
  })

  it('does not advertise outbound file sharing while attachments are dropped', async () => {
    expect(discordCapabilities.fileSharing).toBe(false)
    expect(discordCapabilities.inlineImages).toBe(false)
    expect(discordCapabilities.maxFileSize).toBeUndefined()
    expect(discordCapabilities.supportedMimeTypes).toBeUndefined()

    const native = await convertOutboundForDiscord({
      body: 'hello',
      bodyFormat: 'text',
      attachments: [{ filename: 'a.png', contentType: 'image/png', size: 12, url: 'https://example/a.png' }],
    } as Parameters<typeof convertOutboundForDiscord>[0])
    expect(native.metadata?.droppedAttachmentCount).toBe(1)

    const restClient = getDiscordRestClient() as unknown as Record<string, unknown>
    expect(restClient.uploadAttachment).toBeUndefined()
  })

  it('does not advertise typing, presence or stickers — none of them are implemented', () => {
    expect(discordCapabilities.typingIndicators).toBe(false)
    expect(discordCapabilities.presence).toBe(false)
    expect(discordCapabilities.stickers).toBe(false)
  })

  it('does not advertise threading while no hub producer writes an outbound reply id', async () => {
    // `convertOutboundForDiscord` reads `channelMetadata.replyToExternalId` and
    // would emit a `message_reference` from it — but that key only ever exists on
    // the INBOUND `NormalizedInboundMessage` shape. The hub's outbound metadata
    // producers (`send-as-user.ts`, `deliver-outbound-message.ts`) write the
    // email-shaped `inReplyTo` / `references` instead, so the branch below is
    // unreachable in production. Confirmed against a live bot in #5541.
    expect(discordCapabilities.threading).toBe(false)

    const withoutReplyId = await convertOutboundForDiscord({
      body: 'hello',
      bodyFormat: 'text',
      channelMetadata: { inReplyTo: 'some-parent-id', references: ['some-parent-id'] },
    } as Parameters<typeof convertOutboundForDiscord>[0])
    expect(withoutReplyId.metadata?.messageReferenceId).toBeUndefined()

    // The conversion itself stays ready, so the flag flips back with the hub-side
    // producer and nothing else.
    const withReplyId = await convertOutboundForDiscord({
      body: 'hello',
      bodyFormat: 'text',
      channelMetadata: { replyToExternalId: 'parent-snowflake' },
    } as Parameters<typeof convertOutboundForDiscord>[0])
    expect(withReplyId.metadata?.messageReferenceId).toBe('parent-snowflake')
  })

  it('does not advertise rich blocks — outbound is plain markdown, no embeds are built', () => {
    expect(discordCapabilities.richBlocks).toBe(false)
  })

  /**
   * The parity check issue #4663 asks for. `interactiveComponents: true` claims
   * three separate things, so this drives all three end to end rather than
   * asserting the flag against itself: a signed component press is DISPATCHED
   * (not merely deferred), the dispatch NORMALIZES into the hub's inbound path
   * under the matched tenant, and the deferred acknowledgement is REPLACED over
   * Discord's interaction-webhook endpoints. Break any one of them and the flag
   * has to go back to `false`.
   */
  it('advertises interactive components only because a component press really round-trips', async () => {
    expect(discordCapabilities.interactiveComponents).toBe(true)

    const signer = makeSigner()
    const timestamp = '1700000000'
    const rawBody = JSON.stringify({
      type: DiscordInteractionType.MESSAGE_COMPONENT,
      id: 'interaction-1',
      token: 'interaction-token',
      application_id: 'app-1',
      channel_id: 'discord-channel-1',
      member: { user: { id: 'user-1', username: 'ada' } },
      data: { custom_id: 'escalate', values: ['tier-2'] },
    })

    // 1. The endpoint answers with a deferred ack AND the work that will replace it.
    const result = handleDiscordInteraction({
      rawBody,
      signatureHex: signer.sign(timestamp + rawBody),
      timestamp,
      freshness: { nowEpochSeconds: Number(timestamp) },
      candidates: [
        {
          channelId: 'ch-1',
          channelType: 'discord',
          tenantId: 't-1',
          organizationId: 'o-1',
          publicKey: signer.publicKeyHex,
          applicationId: 'app-1',
          credentialScope: { tenantId: 't-1', organizationId: 'o-1', userId: null },
        },
      ],
    })
    expect(result.body).toEqual({ type: DiscordInteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE })
    expect(result.dispatch).not.toBeNull()

    // 2. That dispatch becomes a hub inbound job pinned to the matched tenant.
    const inboundJob = buildInteractionInboundJob({
      dispatch: result.dispatch!,
      channel: { channelId: 'ch-1', channelType: 'discord', tenantId: 't-1', organizationId: 'o-1' },
    })
    expect(inboundJob).toMatchObject({ providerKey: 'discord', scope: { tenantId: 't-1', organizationId: 'o-1' } })

    // 3. And the "thinking…" placeholder is really replaced over REST.
    const editOriginalInteractionResponse = jest.fn(async () => {})
    const delivery = await sendInteractionFollowUp(
      { editOriginalInteractionResponse } as unknown as Parameters<typeof sendInteractionFollowUp>[0],
      { applicationId: 'app-1', interactionToken: result.dispatch!.token, content: 'recorded' },
    )
    expect(delivery).toBe('edited-original')
    expect(editOriginalInteractionResponse).toHaveBeenCalledWith('app-1', 'interaction-token', {
      content: 'recorded',
      ephemeral: undefined,
    })

    // The REST client the adapter actually uses must expose both halves of the
    // follow-up contract, so a client swap cannot quietly drop them.
    const restClient = getDiscordRestClient() as unknown as Record<string, unknown>
    expect(typeof restClient.editOriginalInteractionResponse).toBe('function')
    expect(typeof restClient.createInteractionFollowUp).toBe('function')
  })

  it('keeps the capabilities that are actually backed by adapter methods', () => {
    expect(discordCapabilities.richText).toBe(true)
    expect(discordCapabilities.reactions).toBe(true)
    expect(discordCapabilities.editMessage).toBe(true)
    expect(discordCapabilities.deleteMessage).toBe(true)
    expect(discordCapabilities.conversationHistory).toBe(true)
    expect(discordCapabilities.realtimePush).toBe(true)
    expect(discordCapabilities.supportedBodyFormats).toEqual(['text', 'markdown'])
    expect(discordCapabilities.maxBodyLength).toBe(DISCORD_MAX_BODY_LENGTH)
  })
})
