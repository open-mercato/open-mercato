import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError, forbidden } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Role } from '@open-mercato/core/modules/auth/data/entities'
import { enforceTenantSelection, normalizeTenantId, resolveIsSuperAdmin } from './tenantAccess'

function roleNotFound(): never {
  throw new CrudHttpError(404, { error: 'Role not found' })
}

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
  body?: { id?: unknown } | null
  query?: { id?: unknown } | null
}

function extractRoleId(input: Record<string, unknown>): string | null {
  const payload = input as RoleTenantPayload
  const candidates: unknown[] = [payload.id, payload.body?.id, payload.query?.id]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length) return candidate
  }
  return null
}

async function assertActorOwnsRole(
  roleId: string,
  ctx: RoleTenantAccessCtx,
): Promise<{ matched: boolean }> {
  const auth = ctx.auth
  if (!auth) throw forbidden('Not authorized')
  const em = (ctx.container.resolve('em') as EntityManager)
  const existing = await findOneWithDecryption(
    em,
    Role,
    { id: roleId, deletedAt: null },
    {},
    { tenantId: null, organizationId: null },
  )
  if (!existing) return { matched: false }

  const isSuperAdmin = await resolveIsSuperAdmin(ctx)
  if (isSuperAdmin) return { matched: true }

  const actorTenant = normalizeTenantId(auth.tenantId ?? null) ?? null
  const existingTenantId = normalizeTenantId(existing.tenantId ?? null) ?? null
  // Unified 404 for "out of scope" — matches grantChecks.assertActorCanAccessRoleTarget
  // and prevents existence enumeration of foreign-tenant or global roles.
  if (!actorTenant) roleNotFound()
  if (existingTenantId !== actorTenant) roleNotFound()
  return { matched: true }
}

export async function enforceRoleTenantAccess(
  mode: 'create' | 'update' | 'delete',
  input: Record<string, unknown>,
  ctx: RoleTenantAccessCtx,
): Promise<Record<string, unknown>> {
  const auth = ctx.auth
  if (!auth) throw forbidden('Not authorized')

  if (mode === 'create') {
    const tenantId = await enforceTenantSelection(ctx, (input as RoleTenantPayload).tenantId)
    return { ...input, tenantId }
  }

  if (mode === 'delete') {
    const roleId = extractRoleId(input)
    if (!roleId) return input
    await assertActorOwnsRole(roleId, ctx)
    return input
  }

  // mode === 'update'
  const roleIdCandidate = (input as RoleTenantPayload).id
  const roleId = typeof roleIdCandidate === 'string' ? roleIdCandidate : null
  if (!roleId) return input

  const ownership = await assertActorOwnsRole(roleId, ctx)
  if (!ownership.matched) return input

  if ((input as RoleTenantPayload).tenantId === undefined) {
    return input
  }

  const tenantId = await enforceTenantSelection(ctx, (input as RoleTenantPayload).tenantId)
  return { ...input, tenantId }
}
