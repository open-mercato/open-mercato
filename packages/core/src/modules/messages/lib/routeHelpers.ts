import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import { CHANNEL_THREAD_FALLBACK_FEATURE } from './channelThreadAccess'

export function hasOrganizationAccess(
  scopeOrganizationId: string | null,
  messageOrganizationId: string | null | undefined,
): boolean {
  if (scopeOrganizationId) {
    return messageOrganizationId === scopeOrganizationId
  }
  return messageOrganizationId == null
}

export type MessageScope = {
  tenantId: string
  organizationId: string | null
  userId: string
}

export async function resolveMessageContext(req: Request): Promise<{
  ctx: Awaited<ReturnType<typeof resolveRequestContext>>['ctx']
  scope: MessageScope
}> {
  const { ctx } = await resolveRequestContext(req)
  return {
    ctx,
    scope: {
      tenantId: ctx.auth?.tenantId ?? '',
      organizationId: ctx.auth?.orgId ?? null,
      userId: ctx.auth?.sub ?? '',
    },
  }
}

type RbacService = {
  userHasAllFeatures: (
    userId: string,
    required: string[],
    scope: { tenantId: string | null; organizationId: string | null }
  ) => Promise<boolean>
}

export async function parseRequestBodySafe(req: Request): Promise<unknown> {
  try {
    const text = await req.text()
    if (!text) return {}
    return JSON.parse(text)
  } catch {
    return {}
  }
}

/**
 * Whether the caller may fall back to the channels hub's access rule on a
 * channel-linked thread (#5535).
 *
 * Resolved through RBAC, never through `ctx.auth.features`: the session JWT
 * carries no `features` claim, so reading it here would deny every caller —
 * a tenant admin included — and re-close the very journey #5535 opened. RBAC is
 * also what makes the check wildcard-aware. Fails closed, like the sibling
 * feature checks in this file.
 */
export async function canUseChannelThreadFallback(
  ctx: Awaited<ReturnType<typeof resolveRequestContext>>['ctx'],
  scope: MessageScope,
): Promise<boolean> {
  if (!scope.userId || !scope.tenantId) return false
  try {
    const rbac = ctx.container.resolve('rbacService') as RbacService | undefined
    if (typeof rbac?.userHasAllFeatures !== 'function') return false
    return await rbac.userHasAllFeatures(scope.userId, [CHANNEL_THREAD_FALLBACK_FEATURE], {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
  } catch {
    return false
  }
}

export async function canUseMessageEmailFeature(
  ctx: Awaited<ReturnType<typeof resolveRequestContext>>['ctx'],
  scope: MessageScope,
): Promise<boolean> {
  if (!scope.userId || !scope.tenantId) return false

  const rbac = ctx.container.resolve('rbacService') as RbacService
  return rbac.userHasAllFeatures(scope.userId, ['messages.email'], {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
}
