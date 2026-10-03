import { EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE } from './composeSourceChannelType'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

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

/**
 * Feature a caller must hold before the channel-thread fallback may widen a
 * route's participant test.
 *
 * The fallback delegates to `assertCanAccessChannel`, which grants every shared
 * channel unconditionally and documents its precondition as "a caller the route
 * already feature-gated". Routes that are `requireAuth`-only must therefore
 * apply this gate themselves before consulting the facade.
 */
export const CHANNEL_THREAD_FALLBACK_FEATURE = 'messages.view'

type ContainerLike = {
  resolve: <T = unknown>(name: string, options?: { allowUnregistered?: boolean }) => T
}

type ChannelThreadLookupOptions = { throwOnError?: boolean }

type ResolveChannelThreadAccessService = (
  container: ContainerLike,
  scope: ChannelThreadScope,
  reference: ChannelThreadReference,
  actor: { userId: string | null; features: string[] },
  options?: ChannelThreadLookupOptions,
) => Promise<ChannelThreadAccessInfo | null>

function tryResolveChannelThreadAccessService(
  container: ContainerLike,
  options?: ChannelThreadLookupOptions,
): ResolveChannelThreadAccessService | undefined {
  try {
    const service = container.resolve<ResolveChannelThreadAccessService>(
      'communicationChannelsResolveChannelThreadAccess',
      options?.throwOnError ? { allowUnregistered: true } : undefined,
    )
    return typeof service === 'function' ? service : undefined
  } catch (error) {
    if (options?.throwOnError) throw error
    // `communication_channels` is optional: without it no thread can be
    // channel-linked, so "internal thread" is both correct and fail-closed.
    // A container that answers with a non-callable instead of throwing reads
    // the same way.
    return undefined
  }
}

/**
 * Granted features of the acting user, read defensively off the command context.
 *
 * These are **passed through** to `assertCanAccessChannel`, which currently
 * discards them (`void userFeatures`) and keeps them on its signature only for
 * the v2 admin-oversight rule. Nothing here authorizes anything: a route or
 * command that needs a feature gate before widening its own participant test
 * MUST apply {@link CHANNEL_THREAD_FALLBACK_FEATURE} itself.
 */
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
 *
 * `actor.features` is a pass-through to the hub's own access rule, not an
 * authorization input — see {@link resolveActorFeatures}.
 * `throwOnError` distinguishes lookup failures from a genuinely internal thread.
 */
export async function resolveMessageChannelThreadAccess(
  container: ContainerLike,
  scope: ChannelThreadScope,
  reference: ChannelThreadReference,
  actor: { userId: string | null; features: string[] },
  options?: ChannelThreadLookupOptions,
): Promise<ChannelThreadAccessInfo | null> {
  if (!reference.messageThreadId && !reference.externalConversationId) return null
  try {
    const resolveChannelThreadAccess = tryResolveChannelThreadAccessService(container, options)
    if (!resolveChannelThreadAccess) return null
    return options
      ? await resolveChannelThreadAccess(container, scope, reference, actor, options)
      : await resolveChannelThreadAccess(container, scope, reference, actor)
  } catch (error) {
    if (!options?.throwOnError) throw error
    try {
      getTelemetryRuntime()?.reportError(error, {
        module: 'messages', code: 'messages.channel_thread_lookup_failed',
      })
    } finally {
      throw error
    }
  }
}

export { EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE }
