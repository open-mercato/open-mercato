import { canUseChannelThreadFallback } from './routeHelpers'
import type { ChannelInboxPredicate } from './participantScope'

type ContainerLike = { resolve: <T = unknown>(name: string) => T }

export type ChannelInboxScope = {
  userId: string
  tenantId: string
  organizationId: string | null
}

type BuildChannelInboxPredicate = (
  eb: Parameters<ChannelInboxPredicate>[0],
  scope: { tenantId: string; organizationId: string | null },
  actor: { userId: string | null },
) => ReturnType<ChannelInboxPredicate>

/**
 * The channel-inbox predicate for the caller, or `null` when nothing widens (#6106).
 *
 * `null` unless the caller holds `messages.view` (RBAC, wildcard-aware, never the
 * JWT) — the hub's channel-owner rule grants every shared channel regardless of
 * features, so the feature gate has to come first. A missing hub, or a hub service
 * that is not callable, also reads as `null`: the participant-only rule stays in
 * force.
 *
 * No query runs here. The returned predicate is a SQL fragment the caller embeds in
 * its own query, so there is no thread-id scan, no cap and no per-request lookup.
 */
export async function resolveChannelInboxPredicate(
  container: ContainerLike,
  scope: ChannelInboxScope,
): Promise<ChannelInboxPredicate | null> {
  const callerScope = { userId: scope.userId, tenantId: scope.tenantId, organizationId: scope.organizationId }
  if (!(await canUseChannelThreadFallback({ container }, callerScope))) return null

  let build: BuildChannelInboxPredicate | undefined
  try {
    build = container.resolve<BuildChannelInboxPredicate>('communicationChannelsBuildChannelInboxPredicate')
  } catch {
    return null
  }
  if (typeof build !== 'function') return null

  const hubScope = { tenantId: scope.tenantId, organizationId: scope.organizationId }
  const actor = { userId: scope.userId }
  return (eb) => build!(eb, hubScope, actor)
}
