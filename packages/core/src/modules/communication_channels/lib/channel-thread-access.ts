import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
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
 * `canAccess` reuses {@link assertCanAccessChannel}: a personal mailbox stays
 * owner-only, a tenant-wide / shared channel is open to any caller the route
 * already feature-gated. Returns `null` when the thread is not channel-linked —
 * an internal message keeps the participant rule untouched.
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

  const mapping = await findOneWithDecryption(
    em,
    ChannelThreadMapping,
    messageThreadId ? { messageThreadId, ...baseFilter } : { externalConversationId, ...baseFilter },
    undefined,
    dscope,
  )
  if (!mapping) return null

  const channel = await findOneWithDecryption(
    em,
    CommunicationChannel,
    {
      id: mapping.channelId,
      tenantId: scope.tenantId,
      ...channelOrgScopeWhere(scope.organizationId),
      deletedAt: null,
    },
    undefined,
    dscope,
  )
  if (!channel) return null

  let canAccess = true
  try {
    assertCanAccessChannel(channel, actor.userId, actor.features)
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

/**
 * Upper bound on channel threads a single list widening will consider. Above it the
 * caller gets `null` (fail closed: no widening) instead of an unbounded `IN (...)`.
 */
export const CHANNEL_THREAD_LIST_LIMIT = 5000

/**
 * Message thread ids of every channel-linked thread the actor may act on, for the
 * inbox list (#6106). The list-shaped counterpart of {@link resolveChannelThreadAccess}:
 * one bounded query instead of one lookup per message.
 *
 * Returns `null` when the tenant has more channel threads than
 * {@link CHANNEL_THREAD_LIST_LIMIT} — the caller then widens nothing.
 */
export async function listAccessibleChannelThreadIds(
  container: AppContainer,
  scope: ChannelThreadScope,
  actor: ChannelThreadActor,
): Promise<string[] | null> {
  const em = (container.resolve('em') as EntityManager).fork()
  const dscope = { tenantId: scope.tenantId, organizationId: scope.organizationId ?? null }
  const baseFilter = { tenantId: scope.tenantId, organizationId: scope.organizationId ?? null }

  const mappings = await findWithDecryption(
    em,
    ChannelThreadMapping,
    baseFilter,
    { limit: CHANNEL_THREAD_LIST_LIMIT + 1 },
    dscope,
  )
  if (mappings.length === 0) return []
  if (mappings.length > CHANNEL_THREAD_LIST_LIMIT) return null

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

  const accessibleChannelIds = new Set<string>()
  for (const channel of channels) {
    try {
      assertCanAccessChannel(channel, actor.userId, actor.features)
      accessibleChannelIds.add(channel.id)
    } catch {
      // Not accessible to this actor: its threads stay out of the widening.
    }
  }

  return mappings
    .filter((mapping) => accessibleChannelIds.has(mapping.channelId))
    .map((mapping) => mapping.messageThreadId)
}
