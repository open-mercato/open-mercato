import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import { hasFeature } from '@open-mercato/shared/security/features'

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
  loadAcl: (
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null }
  ) => Promise<{ features?: string[]; isSuperAdmin?: boolean }>
}

export async function canUseMessageEmailFeature(
  ctx: Awaited<ReturnType<typeof resolveRequestContext>>['ctx'],
  scope: MessageScope,
): Promise<boolean> {
  if (!scope.userId || !scope.tenantId) return false

  const rbac = ctx.container.resolve('rbacService') as RbacService
  const acl = await rbac.loadAcl(scope.userId, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })

  return Boolean(acl.isSuperAdmin) || hasFeature(acl.features, 'messages.email')
}
