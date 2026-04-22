import type { EntityManager } from '@mikro-orm/postgresql'
import { forbidden } from '@open-mercato/shared/lib/crud/errors'
import { Role } from '@open-mercato/core/modules/auth/data/entities'
import { enforceTenantSelection, normalizeTenantId, resolveIsSuperAdmin } from './tenantAccess'

type RoleTenantAccessCtx = {
  auth: {
    tenantId?: string | null
    sub?: string | null
    orgId?: string | null
    roles?: string[]
    isSuperAdmin?: boolean
  } | null
  container: { resolve<T = unknown>(name: string): T }
}

type RoleTenantPayload = {
  id?: unknown
  tenantId?: unknown
}

export async function enforceRoleTenantAccess(
  mode: 'create' | 'update',
  input: Record<string, unknown>,
  ctx: RoleTenantAccessCtx,
): Promise<Record<string, unknown>> {
  const auth = ctx.auth
  if (!auth) throw forbidden('Not authorized')
  const isSuperAdmin = await resolveIsSuperAdmin(ctx)

  if (mode === 'create') {
    const tenantId = await enforceTenantSelection(ctx, (input as RoleTenantPayload).tenantId)
    return { ...input, tenantId }
  }

  const roleIdCandidate = (input as RoleTenantPayload).id
  const roleId = typeof roleIdCandidate === 'string' ? roleIdCandidate : null
  if (!roleId) return input

  const em = (ctx.container.resolve('em') as EntityManager)
  const existing = await em.findOne(Role, { id: roleId, deletedAt: null })
  if (!existing) return input

  const actorTenant = normalizeTenantId(auth.tenantId ?? null) ?? null
  const existingTenantId = normalizeTenantId(existing.tenantId ?? null) ?? null

  if (!isSuperAdmin && existingTenantId !== actorTenant) {
    throw forbidden('Not authorized')
  }

  if ((input as RoleTenantPayload).tenantId === undefined) {
    return input
  }

  const tenantId = await enforceTenantSelection(ctx, (input as RoleTenantPayload).tenantId)
  return { ...input, tenantId }
}
