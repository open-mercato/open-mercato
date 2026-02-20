import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
export { assertFound } from '@open-mercato/shared/lib/crud/errors'
export { ensureOrganizationScope, ensureSameScope } from '@open-mercato/shared/lib/commands/scope'
export { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'

export function ensureTenantScope(ctx: CommandRuntimeContext, tenantId: string): void {
  const currentTenant = ctx.auth?.tenantId ?? null
  if (currentTenant && currentTenant !== tenantId) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
}

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
  message: string
): Promise<T> {
  const entity = await em.findOne(entityClass, { id, deletedAt: null })
  if (!entity) throw new CrudHttpError(404, { error: message })
  return entity
}
