import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
export { assertFound } from '@open-mercato/shared/lib/crud/errors'
export { ensureOrganizationScope, ensureSameScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
export { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'

export function cloneJson<T>(value: T): T {
  if (value === null || value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

export function toNumericString(value: number | null | undefined): string | null {
  if (value === undefined || value === null) return null
  return value.toString()
}

export async function requireScopedEntity<T extends { id: string; deletedAt?: Date | null }>(
  em: EntityManager,
  entityClass: { new (): T },
  id: string,
  message: string,
  scope: { organizationId: string | null; tenantId: string | null } = { organizationId: null, tenantId: null },
): Promise<T> {
  const where: Record<string, unknown> = { id, deletedAt: null }
  if (scope.organizationId) where.organizationId = scope.organizationId
  if (scope.tenantId) where.tenantId = scope.tenantId
  const entity = await findOneWithDecryption(em, entityClass, where, {}, scope)
  if (!entity) throw new CrudHttpError(404, { error: message })
  return entity
}
