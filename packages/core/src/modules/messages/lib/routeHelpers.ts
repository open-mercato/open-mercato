import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import {
  CHANNEL_THREAD_FALLBACK_FEATURE,
  EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE,
  resolveActorFeatures,
  resolveMessageChannelThreadAccess,
} from './channelThreadAccess'

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
 *
 * Takes only the container, so the reply and forward commands apply the same
 * gate as the read routes (#6355).
 */
export async function canUseChannelThreadFallback(
  ctx: { container: { resolve: (name: string) => unknown } },
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

/**
 * Whether the caller may work the channel-linked thread `message` belongs to
 * through the channels hub's access rule, rather than as a participant (#5535).
 *
 * Shared by every read route that widens its participant test for channel
 * threads — the detail read, the attachments list and the forward preview — so
 * the three cannot drift apart (#6354). Only channel-sourced messages pay the
 * lookup; the fallback is feature-gated through {@link canUseChannelThreadFallback}
 * because the hub's rule grants every shared channel unconditionally. An
 * internal thread, a missing hub or a denied gate all read `false`, leaving the
 * participant rule in force.
 *
 * Callers still decide what the widening covers: channel access never opens a
 * message that is not explicitly public.
 */
export async function hasChannelThreadReadAccess(
  ctx: Awaited<ReturnType<typeof resolveRequestContext>>['ctx'],
  scope: MessageScope,
  message: { id: string; threadId?: string | null; sourceEntityType?: string | null },
): Promise<boolean> {
  if (message.sourceEntityType !== EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE) return false
  if (!(await canUseChannelThreadFallback(ctx, scope))) return false
  const channelThread = await resolveMessageChannelThreadAccess(
    ctx.container,
    { tenantId: scope.tenantId, organizationId: scope.organizationId ?? null },
    { messageThreadId: message.threadId ?? message.id },
    { userId: scope.userId, features: resolveActorFeatures(ctx.auth) },
  )
  return channelThread?.canAccess === true
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
