import type { EntityManager } from '@mikro-orm/core'

type Scope = { organizationId?: string | null; organizationIds?: string[] | null; tenantId?: string | null }

export function buildScopedWhere(
  base: Record<string, any>,
  scope: Scope & { orgField?: string | null; tenantField?: string | null; softDeleteField?: string | null }
): Record<string, any> {
  const where: any = { ...base }
  const orgField = scope.orgField === null ? null : (scope.orgField as string) || 'organizationId'
  const tenantField = scope.tenantField === null ? null : (scope.tenantField as string) || 'tenantId'
  const softField = scope.softDeleteField === null ? null : (scope.softDeleteField as string) || 'deletedAt'

  if (orgField) {
    if (scope.organizationIds !== undefined) {
      const ids = (scope.organizationIds ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0)
      if (ids.length === 0) {
        where[orgField] = { $in: [] }
      } else if (ids.length === 1) {
        where[orgField] = ids[0]
      } else {
        where[orgField] = { $in: ids }
      }
    } else if (scope.organizationId !== undefined) {
      where[orgField] = scope.organizationId
    }
  }

  if (tenantField && scope.tenantId !== undefined) where[tenantField] = scope.tenantId
  if (softField) where[softField] = null
  return where
}

export function extractScopeFromAuth(auth: { orgId?: string | null; tenantId?: string | null } | null | undefined): { organizationId?: string | null; tenantId?: string | null } {
  if (!auth) return {}
  return { organizationId: auth.orgId ?? null, tenantId: auth.tenantId ?? null }
}

export async function findOneScoped<T extends { id: string }>(
  em: EntityManager,
  entity: { new (): T },
  id: string,
  scope: Scope & { orgField?: keyof T; tenantField?: keyof T }
): Promise<T | null> {
  const orgField = (scope.orgField as string) || 'organizationId'
  const tenantField = (scope.tenantField as string) || 'tenantId'
  const where: any = { id }
  if (scope.organizationId != null) where[orgField] = scope.organizationId
  if (scope.tenantId != null) where[tenantField] = scope.tenantId
  return em.getRepository(entity).findOne(where as any)
}

export async function softDelete<T extends { deletedAt?: Date | null }>(
  em: EntityManager,
  entity: T
): Promise<void> {
  ;(entity as any).deletedAt = new Date()
  await em.persistAndFlush(entity)
}
