import { forbidden } from '@open-mercato/shared/lib/crud/errors'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

type TenantGuardCtx = {
  auth: {
    sub?: string | null
    tenantId?: string | null
    orgId?: string | null
    roles?: string[]
    isSuperAdmin?: boolean
  } | null
  container: { resolve<T = unknown>(name: string): T }
}

const SUPER_ADMIN_SYMBOL = Symbol.for('auth.tenantGuard.isSuperAdmin')

export function normalizeTenantId(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  return null
}

export async function resolveIsSuperAdmin(ctx: TenantGuardCtx): Promise<boolean> {
  const cached = (ctx as Record<string, unknown>)[SUPER_ADMIN_SYMBOL]
  if (typeof cached === 'boolean') return cached
  const auth = ctx.auth
  if (!auth?.sub) {
    (ctx as Record<string, unknown>)[SUPER_ADMIN_SYMBOL] = false
    return false
  }
  if (auth.isSuperAdmin === true) {
    (ctx as Record<string, unknown>)[SUPER_ADMIN_SYMBOL] = true
    return true
  }
  if (Array.isArray(auth.roles) && auth.roles.some((role) => role.toLowerCase() === 'superadmin')) {
    (ctx as Record<string, unknown>)[SUPER_ADMIN_SYMBOL] = true
    return true
  }
  try {
    const rbac = ctx.container.resolve<RbacService>('rbacService')
    const acl = await rbac.loadAcl(auth.sub, {
      tenantId: auth.tenantId ?? null,
      organizationId: auth.orgId ?? null,
    })
    const value = !!acl?.isSuperAdmin
    ;(ctx as Record<string, unknown>)[SUPER_ADMIN_SYMBOL] = value
    return value
  } catch (error) {
    console.error('auth.tenantGuard: failed to resolve rbac', error)
    ;(ctx as Record<string, unknown>)[SUPER_ADMIN_SYMBOL] = false
    return false
  }
}

export async function enforceTenantSelection(ctx: TenantGuardCtx, requested: unknown): Promise<string | null> {
  const normalized = normalizeTenantId(requested)
  const actorTenant = normalizeTenantId(ctx.auth?.tenantId ?? null) ?? null
  const isSuperAdmin = await resolveIsSuperAdmin(ctx)

  if (isSuperAdmin) {
    if (normalized === undefined) return actorTenant
    return normalized ?? null
  }

  if (!actorTenant) {
    if (normalized && normalized !== null) {
      throw forbidden('Not authorized to target this tenant.')
    }
    return actorTenant
  }

  if (normalized === undefined) return actorTenant
  if (normalized === actorTenant) return actorTenant
  throw forbidden('Not authorized to target this tenant.')
}
