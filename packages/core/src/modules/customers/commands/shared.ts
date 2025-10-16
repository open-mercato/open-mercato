import type { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerEntity, CustomerTag, CustomerTagAssignment, type CustomerEntityKind } from '../data/entities'
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

export function extractUndoPayload<T>(logEntry: ActionLog | null | undefined): T | null {
  if (!logEntry) return null
  const payload = logEntry.commandPayload as UndoEnvelope<T> | undefined
  if (!payload || typeof payload !== 'object') return null
  if (payload.undo) return payload.undo
  if (payload.value && typeof payload.value === 'object' && payload.value.undo) {
    return payload.value.undo as T
  }
  const entries = Object.entries(payload).find(([key]) => key !== '__redoInput')
  if (entries && entries[1] && typeof entries[1] === 'object' && 'undo' in (entries[1] as Record<string, unknown>)) {
    return (entries[1] as { undo?: T }).undo ?? null
  }
  return null
}

export function assertRecordFound<T>(record: T | null | undefined, message: string): T {
  if (!record) throw new CrudHttpError(404, { error: message })
  return record
}

export async function requireCustomerEntity(
  em: EntityManager,
  id: string,
  kind?: CustomerEntityKind,
  message = 'Customer entity not found'
): Promise<CustomerEntity> {
  const entity = await em.findOne(CustomerEntity, { id, deletedAt: null })
  if (!entity) throw new CrudHttpError(404, { error: message })
  if (kind && entity.kind !== kind) {
    throw new CrudHttpError(400, { error: 'Invalid entity type' })
  }
  return entity
}

export function ensureSameScope(
  entity: Pick<CustomerEntity, 'organizationId' | 'tenantId'>,
  organizationId: string,
  tenantId: string
): void {
  if (entity.organizationId !== organizationId || entity.tenantId !== tenantId) {
    throw new CrudHttpError(403, { error: 'Cross-tenant relation forbidden' })
  }
}

export async function syncEntityTags(
  em: EntityManager,
  entity: CustomerEntity,
  tags: string[] | undefined | null
): Promise<void> {
  if (tags === undefined) return
  const desired = Array.from(new Set((tags ?? []).filter((id) => typeof id === 'string')))
  const existing = await loadEntityTagIds(em, entity)
  const toRemove = existing.filter((id) => !desired.includes(id))
  if (toRemove.length) {
    await em.nativeDelete(CustomerTagAssignment, { entity, tag: { $in: toRemove } })
  }
  const toAdd = desired.filter((id) => !existing.includes(id))
  if (!toAdd.length) return
  const tagsInScope = await em.find(CustomerTag, {
    id: { $in: toAdd },
    organizationId: entity.organizationId,
    tenantId: entity.tenantId,
  })
  if (tagsInScope.length !== toAdd.length) {
    throw new CrudHttpError(400, { error: 'One or more tags not found for this scope' })
  }
  for (const tag of toAdd) {
    const assignment = em.create(CustomerTagAssignment, {
      tenantId: entity.tenantId,
      organizationId: entity.organizationId,
      tag: em.getReference(CustomerTag, tag),
      entity,
    })
    em.persist(assignment)
  }
}

export async function loadEntityTagIds(em: EntityManager, entity: CustomerEntity): Promise<string[]> {
  const assignments = await em.find(CustomerTagAssignment, { entity }, { populate: ['tag'] })
  return assignments.map((assignment) =>
    typeof assignment.tag === 'string' ? assignment.tag : assignment.tag.id
  )
}
