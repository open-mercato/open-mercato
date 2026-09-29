import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CommunicationChannel, ExternalConversation, MessageChannelLink } from '../data/entities'

const logger = createLogger('communication_channels').child({ component: 'resolve-channel-type' })

export type ChannelTypeScope = {
  tenantId: string
  organizationId: string | null
}

export type ChannelTypeReference = {
  /** `ExternalConversation.id`, as carried by a message's `sourceEntityId`. */
  externalConversationId?: string | null
  /** A platform `messages.message` id that may be linked to a channel. */
  messageId?: string | null
}

/**
 * Resolve the channel type behind a platform message or conversation (#4975).
 *
 * Cross-module callers (the `messages` compose route) need to know whether an
 * external correspondent is reachable by email before validating a compose
 * payload, but `messages` may not reach into this module's entities. They
 * resolve this facade from DI instead — mirroring `communicationChannelsSendAsUser`
 * — and treat a `null` result as "unknown", which the messages validator
 * handles fail-closed.
 *
 * Always tenant/organization scoped: a reference that does not resolve inside
 * the caller's scope is reported as unknown rather than looked up globally.
 */
export async function resolveChannelType(
  container: AppContainer,
  scope: ChannelTypeScope,
  reference: ChannelTypeReference,
): Promise<string | null> {
  const em = (container.resolve('em') as EntityManager).fork()
  const dscope = { tenantId: scope.tenantId, organizationId: scope.organizationId ?? null }
  const baseFilter = { tenantId: scope.tenantId, organizationId: scope.organizationId ?? null }

  let externalConversationId = reference.externalConversationId ?? null

  if (!externalConversationId && reference.messageId) {
    // The message is linked to a channel directly — `MessageChannelLink` carries
    // a denormalized channel type, so this is the cheapest hop when it exists.
    const link = await findOneWithDecryption(
      em,
      MessageChannelLink,
      { messageId: reference.messageId, ...baseFilter },
      undefined,
      dscope,
    )
    if (link?.channelType) return link.channelType
    externalConversationId = link?.externalConversationId ?? null
  }

  if (!externalConversationId) return null

  const conversation = await findOneWithDecryption(
    em,
    ExternalConversation,
    { id: externalConversationId, ...baseFilter },
    undefined,
    dscope,
  )
  if (!conversation?.channelId) return null

  const channel = await findOneWithDecryption(
    em,
    CommunicationChannel,
    { id: conversation.channelId, ...baseFilter, deletedAt: null },
    undefined,
    dscope,
  )
  return channel?.channelType ?? null
}

/**
 * Same contract, but never throws: a lookup failure degrades to "unknown" so a
 * transient database error cannot turn into a 500 on an otherwise valid compose.
 * Unknown is the safe answer — the messages validator fails closed on it.
 */
export async function resolveChannelTypeSafely(
  container: AppContainer,
  scope: ChannelTypeScope,
  reference: ChannelTypeReference,
): Promise<string | null> {
  try {
    return await resolveChannelType(container, scope, reference)
  } catch (err) {
    logger.warn('channel type resolution failed, treating the channel as unknown', { err })
    return null
  }
}

/** DI service type for cross-module callers (resolve `communicationChannelsResolveChannelType`). */
export type ResolveChannelTypeService = typeof resolveChannelTypeSafely
