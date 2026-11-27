import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { assertCanAccessChannel, channelOrgScopeWhere } from './access-control'
import { ChannelThreadMapping, CommunicationChannel } from '../data/entities'

const logger = createLogger('communication_channels').child({ component: 'channel-thread-access' })

export type ChannelThreadScope = {
  tenantId: string
  organizationId: string | null
}

export type ChannelThreadReference = {
  /** `messages.message.thread_id` of the thread the caller is acting on. */
  messageThreadId?: string | null
  /** `ExternalConversation.id`, as carried by a message's `sourceEntityId`. */
  externalConversationId?: string | null
}

export type ChannelThreadActor = {
  userId: string | null
  features: string[]
}

export type ChannelThreadAccess = {
  messageThreadId: string
  externalConversationId: string
  channelId: string
  channelType: string
  /** Whether {@link ChannelThreadActor} may act on the channel behind this thread. */
  canAccess: boolean
}

/**
 * Resolve the channel behind a message thread and decide whether the caller may
 * act on it (#5535).
 *
 * An inbound channel message has a synthetic sender (the channel system user)
 * and, when the conversation is unassigned, no `message_recipients` row at all.
 * The `messages` module's sender-or-recipient predicate therefore denies every
 * operator on such a thread, including a tenant admin — the participant test
 * asks a question that a thread whose correspondent is not a platform user
 * cannot answer. For those threads the authorization that actually applies is
 * this module's own channel access rule, so `messages` resolves this facade
 * from DI (mirroring `communicationChannelsResolveChannelType`) instead of
 * reaching into these entities.
 *
 * Thread-wide access requires access to every mapped channel. An explicit
 * external conversation resolves its own channel. Both checks reuse
 * {@link assertCanAccessChannel}, including its owner-only mailbox policy.
 * Returns `null` when no mapped channel resolves in scope.
 *
 * Always tenant/organization scoped: a thread that does not resolve inside the
 * caller's scope reads as not channel-linked rather than being looked up
 * globally.
 */
export async function resolveChannelThreadAccess(
  container: AppContainer,
  scope: ChannelThreadScope,
  reference: ChannelThreadReference,
  actor: ChannelThreadActor,
): Promise<ChannelThreadAccess | null> {
  const messageThreadId = reference.messageThreadId ?? null
  const externalConversationId = reference.externalConversationId ?? null
  if (!messageThreadId && !externalConversationId) return null

  const em = (container.resolve('em') as EntityManager).fork()
  const dscope = { tenantId: scope.tenantId, organizationId: scope.organizationId ?? null }
  const baseFilter = { tenantId: scope.tenantId, organizationId: scope.organizationId ?? null }

  const mappings = await findWithDecryption(
    em,
    ChannelThreadMapping,
    messageThreadId ? { messageThreadId, ...baseFilter } : { externalConversationId, ...baseFilter },
    { orderBy: { createdAt: 'ASC', id: 'ASC' } },
    dscope,
  )
  if (mappings.length === 0) return null

  const channelIds = [...new Set(mappings.map((mapping) => mapping.channelId))]
  const channels = await findWithDecryption(
    em,
    CommunicationChannel,
    {
      id: { $in: channelIds },
      tenantId: scope.tenantId,
      ...channelOrgScopeWhere(scope.organizationId),
      deletedAt: null,
    },
    undefined,
    dscope,
  )
  const channelsById = new Map(channels.map((channel) => [channel.id, channel]))
  const mapping = mappings.find((candidate) => channelsById.has(candidate.channelId))
  const channel = mapping && channelsById.get(mapping.channelId)
  if (!mapping || !channel) return null

  let canAccess = channelsById.size === channelIds.length
  try {
    for (const mappedChannel of channelsById.values()) {
      assertCanAccessChannel(mappedChannel, actor.userId, actor.features)
    }
  } catch {
    canAccess = false
  }

  return {
    messageThreadId: mapping.messageThreadId,
    externalConversationId: mapping.externalConversationId,
    channelId: mapping.channelId,
    channelType: channel.channelType,
    canAccess,
  }
}

/**
 * Same contract, but never throws: a lookup failure degrades to "not
 * channel-linked", which leaves the caller on its pre-existing rule. For the
 * reply guard that is the fail-closed answer — the participant test still
 * applies and a transient database error cannot widen access.
 */
export async function resolveChannelThreadAccessSafely(
  container: AppContainer,
  scope: ChannelThreadScope,
  reference: ChannelThreadReference,
  actor: ChannelThreadActor,
): Promise<ChannelThreadAccess | null> {
  try {
    return await resolveChannelThreadAccess(container, scope, reference, actor)
  } catch (err) {
    logger.warn('channel thread access resolution failed, treating the thread as internal', { err })
    return null
  }
}

/** DI service type for cross-module callers (resolve `communicationChannelsResolveChannelThreadAccess`). */
export type ResolveChannelThreadAccessService = typeof resolveChannelThreadAccessSafely
