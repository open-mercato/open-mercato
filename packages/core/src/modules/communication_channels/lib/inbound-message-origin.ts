import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveCommunicationChannelsSystemUserId } from './system-user'

/**
 * Entity type a channel-backed conversation is exposed under on a message's
 * `sourceEntityType`. Written by `commands/ingest-inbound-message.ts` and
 * inherited by every operator message composed on the same conversation.
 */
export const EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE = 'communication_channels.external_conversation'

/**
 * Dedup key `ingest-inbound-message` stamps on the platform message it composes,
 * so a retried ingest reuses the first attempt's message instead of duplicating
 * it. The `cc:` prefix also identifies the message as ingest-authored — see
 * {@link isIngestedInboundMessage}.
 */
export function buildInboundIdempotencyKey(channelId: string, externalMessageId: string): string {
  return `cc:${channelId}:${externalMessageId}`
}

type InboundMessageOriginInput = {
  message: {
    senderUserId: string
    sourceEntityType?: string | null
    idempotencyKey?: string | null
  }
  /** The `MessageChannelLink` already loaded for this message, if any. */
  existingLink: { direction: 'inbound' | 'outbound' } | null | undefined
  tenantId: string
}

/**
 * Whether a platform message in a channel-linked thread is the one
 * `ingest-inbound-message` composed for an incoming message — as opposed to a
 * message an operator wrote in the same conversation.
 *
 * The distinction matters because the messages module emits
 * `messages.message.sent` for both, and only the operator's message may be
 * delivered outbound. Before #5535 the discriminator was `sourceEntityType`
 * alone, which every operator reply inherits from the message it answers — so
 * operator replies were silently dropped along with the ingested messages.
 *
 * Three signals, checked cheapest-first, because the ingested message's inbound
 * `MessageChannelLink` is written *after* the compose command emits its event
 * and is therefore not guaranteed to be visible yet:
 *
 *   1. an inbound `MessageChannelLink` for this message — authoritative;
 *   2. the `cc:` ingest dedup key ({@link buildInboundIdempotencyKey}) — set
 *      whenever the provider supplied an external message id;
 *   3. the tenant's channel system user as the sender — the ingest attribution
 *      when the conversation has no assigned user.
 */
export async function isIngestedInboundMessage(
  em: EntityManager,
  { message, existingLink, tenantId }: InboundMessageOriginInput,
): Promise<boolean> {
  if (message.sourceEntityType !== EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE) return false
  if (existingLink?.direction === 'inbound') return true
  if (typeof message.idempotencyKey === 'string' && message.idempotencyKey.startsWith('cc:')) return true
  const systemUserId = await resolveCommunicationChannelsSystemUserId(em, tenantId)
  return message.senderUserId === systemUserId
}
