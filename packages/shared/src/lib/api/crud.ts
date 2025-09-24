import type { EntityManager } from '@mikro-orm/core'

type Scope = { organizationId?: string | null; tenantId?: string | null }

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

