import type { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

type UndoEnvelope<T> = {
  undo?: T
  value?: { undo?: T }
  __redoInput?: unknown
  [key: string]: unknown
}

export function ensureTenantScope(ctx: CommandRuntimeContext, tenantId: string): void {
  const currentTenant = ctx.auth?.tenantId ?? null
  if (currentTenant && currentTenant !== tenantId) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
}

export function ensureOrganizationScope(ctx: CommandRuntimeContext, organizationId: string): void {
  const currentOrg = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (currentOrg && currentOrg !== organizationId) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
}

export function ensureSameScope(
  entity: Pick<{ organizationId: string; tenantId: string }, 'organizationId' | 'tenantId'>,
  organizationId: string,
  tenantId: string
): void {
  if (entity.organizationId !== organizationId || entity.tenantId !== tenantId) {
    throw new CrudHttpError(403, { error: 'Cross-tenant relation forbidden' })
  }
}

export function assertFound<T>(value: T | null | undefined, message: string): T {
  if (!value) throw new CrudHttpError(404, { error: message })
  return value
}

export function extractUndoPayload<T>(logEntry: ActionLog | null | undefined): T | null {
  if (!logEntry) return null
  const payload = logEntry.commandPayload as UndoEnvelope<T> | undefined
  if (!payload || typeof payload !== 'object') return null
  if (payload.undo) return payload.undo
  if (payload.value && typeof payload.value === 'object' && payload.value.undo) {
    return payload.value.undo as T
  }
  for (const [key, value] of Object.entries(payload)) {
    if (key === '__redoInput') continue
    if (value && typeof value === 'object' && 'undo' in value) {
      return (value as { undo?: T }).undo ?? null
    }
  }
  return null
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
