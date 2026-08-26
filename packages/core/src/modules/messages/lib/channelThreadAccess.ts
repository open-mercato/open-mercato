import { EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE } from './composeSourceChannelType'

/**
 * The subset of a resolved channel thread this module consumes. Structurally
 * mirrors `communication_channels`' `ChannelThreadAccess` without importing it —
 * the hub is an optional module and `messages` must not depend on its entities.
 */
export type ChannelThreadAccessInfo = {
  messageThreadId: string
  externalConversationId: string
  channelId: string
  channelType: string
  canAccess: boolean
}

export type ChannelThreadScope = {
  tenantId: string
  organizationId: string | null
}

export type ChannelThreadReference = {
  messageThreadId?: string | null
  externalConversationId?: string | null
}

type ContainerLike = { resolve: <T = unknown>(name: string) => T }

type ResolveChannelThreadAccessService = (
  container: ContainerLike,
  scope: ChannelThreadScope,
  reference: ChannelThreadReference,
  actor: { userId: string | null; features: string[] },
) => Promise<ChannelThreadAccessInfo | null>

function tryResolveChannelThreadAccessService(
  container: ContainerLike,
): ResolveChannelThreadAccessService | undefined {
  try {
    return container.resolve<ResolveChannelThreadAccessService>(
      'communicationChannelsResolveChannelThreadAccess',
    )
  } catch {
    // `communication_channels` is optional: without it no thread can be
    // channel-linked, so "internal thread" is both correct and fail-closed.
    return undefined
  }
}

/** Granted features of the acting user, read defensively off the command context. */
export function resolveActorFeatures(auth: unknown): string[] {
  const features = (auth as { features?: unknown } | null | undefined)?.features
  if (!Array.isArray(features)) return []
  return features.filter((value): value is string => typeof value === 'string')
}

/**
 * Resolve the channel thread a message belongs to, together with whether the
 * acting user may act on it (#5535).
 *
 * Returns `null` for an internal thread, for a thread outside the caller's
 * tenant/organization scope, and when the hub module is not installed — every
 * caller treats `null` as "the pre-existing rule applies".
 */
export async function resolveMessageChannelThreadAccess(
  container: ContainerLike,
  scope: ChannelThreadScope,
  reference: ChannelThreadReference,
  actor: { userId: string | null; features: string[] },
): Promise<ChannelThreadAccessInfo | null> {
  if (!reference.messageThreadId && !reference.externalConversationId) return null
  const resolveChannelThreadAccess = tryResolveChannelThreadAccessService(container)
  if (!resolveChannelThreadAccess) return null
  return resolveChannelThreadAccess(container, scope, reference, actor)
}

export { EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE }
