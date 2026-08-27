import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { ChannelCapabilities } from './adapter'
import { ExternalMessage, MessageChannelLink } from '../data/entities'

export interface OutboundReplyRefInput {
  /** `Message.parentMessageId` of the message being delivered. */
  parentMessageId: string | null | undefined
  /** `ChannelThreadMapping.externalConversationId` the message is being sent to. */
  externalConversationId: string
  capabilities: Pick<ChannelCapabilities, 'threading'> | null | undefined
  scope: { tenantId: string; organizationId: string | null }
}

/**
 * Resolve the provider-native id of the message an outbound reply answers, so
 * chat adapters can attach it (Discord `message_reference`, and any provider
 * that threads by message id rather than by RFC 5322 headers).
 *
 * Email providers thread through `inReplyTo` / `references`, which the hub has
 * always produced. Chat providers had no equivalent: `capabilities.threading`
 * described a reply-attachment the hub could never ask for, because nothing on
 * the outbound path wrote the parent's external id into channel metadata
 * (#5541 — the flag had to be declared `false` to stay honest). This is that
 * missing producer.
 *
 * The hub stores everything needed already: the parent hub message owns a
 * `MessageChannelLink` (unique per `message_id`) whose `external_message_id`
 * points at the `ExternalMessage` row carrying the provider's own id — written
 * by both the inbound ingest and outbound delivery paths, so a reply can answer
 * an inbound message or one of our own sends.
 *
 * Returns `null` — never throws a routing decision at the caller — when the
 * provider does not thread, the message is not a reply, the parent never
 * reached this channel, or the parent belongs to a different conversation.
 * Threading is an enhancement to a delivery, never a precondition for one.
 */
export async function resolveOutboundReplyExternalId(
  em: EntityManager,
  input: OutboundReplyRefInput,
): Promise<string | null> {
  // A non-reply can never produce a reference, so check that before anything
  // that costs a query.
  if (!input.parentMessageId) return null
  // Gate on the adapter's own declaration: handing a non-threading provider a key
  // it silently drops is exactly the mismatch `ChannelCapabilities` exists to
  // prevent. Note this gate does NOT spare header-threading providers — the
  // shared email profile declares `threading: true` (`email-capabilities.ts`), so
  // an email reply pays for both lookups below and its converter then ignores the
  // result in favor of `inReplyTo` / `references`. Correct but wasteful;
  // distinguishing id-threading from header-threading needs a capability the
  // contract does not have yet (#5691).
  if (input.capabilities?.threading !== true) return null

  const dscope = {
    tenantId: input.scope.tenantId,
    organizationId: input.scope.organizationId,
  }

  const parentLink = await findOneWithDecryption(
    em,
    MessageChannelLink,
    {
      messageId: input.parentMessageId,
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
    },
    undefined,
    dscope,
  )
  if (!parentLink?.externalMessageId) return null

  // A parent that lives in another conversation would make the provider reject
  // the send (Discord answers `400 Unknown message` for a cross-channel
  // reference). Dropping the reference degrades to an unthreaded reply, which
  // is strictly better than a failed delivery.
  if (parentLink.externalConversationId !== input.externalConversationId) return null

  const parentExternal = await findOneWithDecryption(
    em,
    ExternalMessage,
    {
      id: parentLink.externalMessageId,
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
    },
    undefined,
    dscope,
  )

  if (!parentExternal) return null
  // Re-assert the conversation invariant on the row that actually carries the
  // provider id. Both producers write the link and the external message together,
  // so these cannot disagree today — checking here keeps the guard correct even if
  // that coupling is ever relaxed, rather than trusting a second table's field.
  if (parentExternal.conversationId !== input.externalConversationId) return null

  const externalId = parentExternal.externalMessageId
  return typeof externalId === 'string' && externalId.length > 0 ? externalId : null
}
