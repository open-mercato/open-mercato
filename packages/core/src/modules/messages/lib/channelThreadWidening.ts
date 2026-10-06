import { canUseChannelThreadFallback } from './routeHelpers'

type ContainerLike = { resolve: <T = unknown>(name: string) => T }

export type ChannelThreadWideningScope = {
  userId: string
  tenantId: string
  organizationId: string | null
  features: string[]
}

type ListAccessibleChannelThreadIds = (
  container: ContainerLike,
  scope: { tenantId: string; organizationId: string | null },
  actor: { userId: string | null; features: string[] },
) => Promise<string[] | null>

/**
 * Channel thread ids the caller may widen the inbox to (#6106).
 *
 * Empty unless the caller holds `messages.view` (RBAC, wildcard-aware, not the JWT)
 * — the hub grants every shared channel regardless of features, so the feature gate
 * must come first. A missing hub, a failed lookup, or a tenant over the hub's list
 * limit all resolve to `[]`: the participant-only rule stays in force.
 */
export async function resolveChannelThreadWideningIds(
  container: ContainerLike,
  scope: ChannelThreadWideningScope,
): Promise<string[]> {
  const callerScope = { userId: scope.userId, tenantId: scope.tenantId, organizationId: scope.organizationId }
  if (!(await canUseChannelThreadFallback({ container }, callerScope))) return []

  let list: ListAccessibleChannelThreadIds | undefined
  try {
    list = container.resolve<ListAccessibleChannelThreadIds>('communicationChannelsListAccessibleChannelThreadIds')
  } catch {
    return []
  }
  if (typeof list !== 'function') return []

  try {
    const ids = await list(
      container,
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
      { userId: scope.userId, features: scope.features },
    )
    return Array.isArray(ids) ? ids : []
  } catch {
    return []
  }
}
