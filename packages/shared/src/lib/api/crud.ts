import type { EntityManager } from '@mikro-orm/core'

type Scope = { organizationId?: string | null; tenantId?: string | null }

export function buildScopedWhere(base: Record<string, any>, scope: Scope & { orgField?: string; tenantField?: string; softDeleteField?: string }): Record<string, any> {
  const where: any = { ...base }
  const orgField = (scope.orgField as string) || 'organizationId'
  const tenantField = (scope.tenantField as string) || 'tenantId'
  const softField = (scope.softDeleteField as string) || 'deletedAt'
  if (scope.organizationId !== undefined) where[orgField] = scope.organizationId
  if (scope.tenantId !== undefined) where[tenantField] = scope.tenantId
  where[softField] = null
  return where
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

