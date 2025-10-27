import type { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerDeal, CustomerEntity, CustomerTag, CustomerTagAssignment, CustomerDictionaryEntry, type CustomerEntityKind } from '../data/entities'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

type UndoEnvelope<T> = {
  undo?: T
  value?: { undo?: T }
  __redoInput?: unknown
  [key: string]: unknown
}

export function normalizeDictionaryColor(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return null
  const hexMatch = /^#([0-9a-fA-F]{6})$/.exec(trimmed)
  if (!hexMatch) return null
  return `#${hexMatch[1].toLowerCase()}`
}

export function normalizeDictionaryIcon(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 48)
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

export async function requireDealInScope(
  em: EntityManager,
  dealId: string | null | undefined,
  tenantId: string,
  organizationId: string
): Promise<CustomerDeal | null> {
  if (!dealId) return null
  const deal = await em.findOne(CustomerDeal, { id: dealId, deletedAt: null })
  if (!deal) throw new CrudHttpError(400, { error: 'Deal not found' })
  ensureSameScope(deal, organizationId, tenantId)
  return deal
}

const DICTIONARY_KINDS = new Set([
  'status',
  'source',
  'lifecycle_stage',
  'address_type',
  'activity_type',
  'deal_status',
  'pipeline_stage',
  'job_title',
  'industry',
])

export async function ensureDictionaryEntry(
  em: EntityManager,
  params: {
    tenantId: string
    organizationId: string
    kind:
      | 'status'
      | 'source'
      | 'lifecycle_stage'
      | 'address_type'
      | 'activity_type'
      | 'deal_status'
      | 'pipeline_stage'
      | 'job_title'
      | 'industry'
    value: string
    label?: string | null
    color?: string | null | undefined
    icon?: string | null | undefined
  }
): Promise<CustomerDictionaryEntry | null> {
  const trimmed = params.value?.trim()
  if (!trimmed) return null
  if (!DICTIONARY_KINDS.has(params.kind)) {
    throw new CrudHttpError(400, { error: 'Unsupported dictionary kind' })
  }
  const normalized = trimmed.toLowerCase()
  const color = params.color === undefined ? undefined : normalizeDictionaryColor(params.color)
  const icon = params.icon === undefined ? undefined : normalizeDictionaryIcon(params.icon)
  const existing = await em.findOne(CustomerDictionaryEntry, {
    tenantId: params.tenantId,
    organizationId: params.organizationId,
    kind: params.kind,
    normalizedValue: normalized,
  })
  if (existing) {
    let changed = false
    if (color !== undefined) {
      if (existing.color !== color) {
        existing.color = color ?? null
        changed = true
      }
    }
    if (icon !== undefined) {
      if (existing.icon !== icon) {
        existing.icon = icon ?? null
        changed = true
      }
    }
    if (changed) {
      existing.updatedAt = new Date()
      em.persist(existing)
    }
    return existing
  }
  const entry = em.create(CustomerDictionaryEntry, {
    tenantId: params.tenantId,
    organizationId: params.organizationId,
    kind: params.kind,
    value: trimmed,
    label: params.label?.trim() || trimmed,
    normalizedValue: normalized,
    color: color ?? null,
    icon: icon ?? null,
  })
  em.persist(entry)
  return entry
}
