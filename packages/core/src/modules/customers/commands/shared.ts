import type { EntityManager, EntityName, FilterQuery } from '@mikro-orm/postgresql'
import { CustomerDeal, CustomerEntity, CustomerTag, CustomerTagAssignment, CustomerDictionaryEntry, type CustomerEntityKind } from '../data/entities'
import { CrudHttpError, forbidden, notFound } from '@open-mercato/shared/lib/crud/errors'
import { buildScopedWhere } from '@open-mercato/shared/lib/api/crud'
import { isUnrestrictedOrganizationScope } from '@open-mercato/shared/lib/auth/organizationAccess'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureSameScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { loadEntityRecordScope } from '@open-mercato/shared/lib/db/recordScope'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EventBus } from '@open-mercato/events'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { CacheStrategy } from '@open-mercato/cache'
import { invalidateDictionaryCache } from '../api/dictionaries/cache'
import { isPipelineStageColorTone } from '../lib/pipelineStageColors'

const logger = createLogger('customers')
export { ensureOrganizationScope, ensureSameScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
export { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'

export const CUSTOMER_ENTITY_UNDO_DATE_OPTIONS = {
  datePaths: ['before.entity.nextInteractionAt'],
} as const

export function normalizeDictionaryColor(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return null
  const hexMatch = /^#([0-9a-fA-F]{6})$/.exec(trimmed)
  if (!hexMatch) return null
  return `#${hexMatch[1].toLowerCase()}`
}

export function normalizeDictionaryEntryColor(kind: string, color: unknown): string | null | undefined {
  if (color === undefined) return undefined
  if (kind === 'pipeline_stage' && typeof color === 'string') {
    const trimmed = color.trim()
    if (isPipelineStageColorTone(trimmed)) return trimmed
  }
  return normalizeDictionaryColor(color)
}

export function normalizeDictionaryIcon(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 48)
}

export { assertFound } from '@open-mercato/shared/lib/crud/errors'

export type CommandScopeWhere = {
  tenantId?: string
  organizationId?: { $in: string[] }
}

// Filter to merge into a write command's target lookup so ids outside the caller's
// tenant (from auth, or organizationScope.tenantId for auth-less callers) and, for
// restricted callers, outside the allowed organizations resolve as "not found"
// instead of being loaded and rejected afterwards. The ensure*Scope checks stay as
// the second layer (#7598, mirrors catalog #3825).
export function commandScopeWhere(
  ctx: Pick<CommandRuntimeContext, 'auth' | 'organizationScope'>,
): CommandScopeWhere {
  const where: CommandScopeWhere = {}
  const tenantId = ctx.auth ? ctx.auth.tenantId ?? null : ctx.organizationScope?.tenantId ?? null
  if (tenantId) where.tenantId = tenantId
  const allowedIds = ctx.organizationScope?.allowedIds
  if (ctx.auth?.isSuperAdmin !== true && Array.isArray(allowedIds)) {
    where.organizationId = { $in: [...allowedIds] }
  }
  return where
}

export type CustomerEntityScope = {
  tenantId: string
  organizationId: string
}

export function buildCustomerCommandLookup(where: Record<string, unknown>, ctx: CommandRuntimeContext) {
  const isSuperAdmin = ctx.auth?.isSuperAdmin === true
  const organizationScope = ctx.organizationScope
  const tenantId = ctx.auth ? (ctx.auth.tenantId ?? null) : (organizationScope?.tenantId ?? null)
  if (ctx.auth && !isSuperAdmin && (!tenantId || (organizationScope && !organizationScope.tenantId))) {
    throw forbidden()
  }
  let organizationIds: string[] | undefined
  if (organizationScope) {
    if (!isUnrestrictedOrganizationScope({ isSuperAdmin, allowedOrganizationIds: organizationScope.allowedIds })) {
      organizationIds = organizationScope.allowedIds ?? []
    }
  } else if (!isSuperAdmin) {
    const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId
    if (organizationId) organizationIds = [organizationId]
  }
  return {
    where: buildScopedWhere(where, {
      tenantId: tenantId ?? undefined,
      organizationIds,
      softDeleteField: null,
    }),
    scope: { tenantId, organizationId: organizationIds?.length === 1 ? organizationIds[0] : null },
  }
}

export async function findScopedCustomerCommandRecord<Entity extends object, Hint extends string = never>(
  em: EntityManager,
  entity: EntityName<Entity>,
  where: Record<string, unknown>,
  options: Parameters<typeof findOneWithDecryption<Entity, Hint>>[3],
  ctx: CommandRuntimeContext,
): Promise<Entity | null> {
  const record = await findScopedCustomerCommandTarget(em, entity, where, options, ctx)
  if (!record && ctx.auth && typeof where.id === 'string') {
    const entityType = em.getMetadata().get(entity).className
    const recordScope = await loadEntityRecordScope(em as unknown as Parameters<typeof loadEntityRecordScope>[0], entityType, where.id)
    if (recordScope && await em.count(entity, { ...where, ...recordScope } as FilterQuery<NoInfer<Entity>>)) {
      if (recordScope.tenantId) ensureTenantScope(ctx, recordScope.tenantId)
      if (recordScope.organizationId) ensureOrganizationScope(ctx, recordScope.organizationId)
    }
  }
  return record
}

export async function findScopedCustomerCommandTarget<Entity extends object, Hint extends string = never>(
  em: EntityManager,
  entity: EntityName<Entity>,
  where: Record<string, unknown>,
  options: Parameters<typeof findOneWithDecryption<Entity, Hint>>[3],
  ctx: CommandRuntimeContext,
): Promise<Entity | null> {
  const lookup = buildCustomerCommandLookup(where, ctx)
  return findOneWithDecryption<Entity, Hint>(em, entity, lookup.where as FilterQuery<Entity>, options, lookup.scope)
}

export async function requireCustomerEntity(
  em: EntityManager,
  id: string,
  scope: CustomerEntityScope,
  kind?: CustomerEntityKind,
  message = 'Customer entity not found'
): Promise<CustomerEntity> {
  const entity = await findOneWithDecryption(
    em,
    CustomerEntity,
    {
      id,
      deletedAt: null,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    undefined,
    scope,
  )
  if (!entity) throw notFound(message)
  if (kind && entity.kind !== kind) {
    throw new CrudHttpError(400, { error: 'Invalid entity type' })
  }
  return entity
}

export async function requireTimelineParentEntity(
  em: EntityManager,
  id: string,
  scope: CustomerEntityScope,
): Promise<CustomerEntity> {
  const entity = await findOneWithDecryption(
    em,
    CustomerEntity,
    {
      id,
      deletedAt: null,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    undefined,
    scope,
  )
  if (entity) {
    if (entity.kind !== 'person' && entity.kind !== 'company') {
      throw new CrudHttpError(422, { error: 'entityId must reference a person or company' })
    }
    return entity
  }
  const deal = await findOneWithDecryption(
    em,
    CustomerDeal,
    {
      id,
      deletedAt: null,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    undefined,
    scope,
  )
  if (deal) {
    throw new CrudHttpError(422, { error: 'entityId must reference a person or company, not a deal' })
  }
  throw notFound('Customer not found')
}

// Profile columns, custom fields, and tags all live outside CustomerEntity, so a
// save that only touches one of them never dirties the entity and its `updated_at`
// (the optimistic-lock version) would stay put — letting a stale second tab
// overwrite the change without a 409 (#7033, #8643). Bump it explicitly whenever
// any sub-collection changed.
export function shouldBumpOptimisticLockVersion(
  profileFieldsUpdated: boolean,
  custom: Record<string, unknown>,
  tags: string[] | undefined | null
): boolean {
  return profileFieldsUpdated || Object.keys(custom).length > 0 || tags !== undefined
}

export async function syncEntityTags(
  em: EntityManager,
  entity: CustomerEntity,
  tags: string[] | undefined | null,
  { ignoreMissing = false }: { ignoreMissing?: boolean } = {},
): Promise<void> {
  if (tags === undefined) return
  const requested = (tags ?? []).filter((id) => typeof id === 'string')
  const desired = Array.from(new Set(ignoreMissing ? requested.map((id) => id.toLowerCase()) : requested))
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
  if (!ignoreMissing && tagsInScope.length !== toAdd.length) {
    throw new CrudHttpError(400, { error: 'One or more tags not found for this scope' })
  }
  const tagsToAssign = ignoreMissing ? tagsInScope.map(({ id }) => id) : toAdd
  for (const tag of tagsToAssign) {
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
  const scope = { tenantId: entity.tenantId, organizationId: entity.organizationId }
  const assignments = await findWithDecryption(
    em,
    CustomerTagAssignment,
    { entity, ...scope },
    { populate: ['tag'] },
    scope,
  )
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
  const deal = await findOneWithDecryption(
    em,
    CustomerDeal,
    { id: dealId, deletedAt: null, tenantId, organizationId },
    undefined,
    { tenantId, organizationId },
  )
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
  'temperature',
  'renewal_quarter',
  'person_company_role',
  'interaction_status',
])

const CUSTOM_DICTIONARY_KIND_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/

export async function ensureDictionaryEntry(
  em: EntityManager,
  params: {
    tenantId: string
    organizationId: string
    kind: string
    value: string
    label?: string | null
    color?: string | null | undefined
    icon?: string | null | undefined
  },
  createdKinds?: Set<string>,
): Promise<CustomerDictionaryEntry | null> {
  const trimmed = params.value?.trim()
  if (!trimmed) return null
  if (!DICTIONARY_KINDS.has(params.kind) && !CUSTOM_DICTIONARY_KIND_PATTERN.test(params.kind)) {
    throw new CrudHttpError(400, { error: 'Unsupported dictionary kind' })
  }
  const normalized = trimmed.toLowerCase()
  const color = normalizeDictionaryEntryColor(params.kind, params.color)
  const icon = params.icon === undefined ? undefined : normalizeDictionaryIcon(params.icon)
  const scope = {
    tenantId: params.tenantId,
    organizationId: params.organizationId,
    kind: params.kind,
    normalizedValue: normalized,
  }
  const now = new Date()
  let entry = await em.findOne(CustomerDictionaryEntry, scope)
  if (!entry) {
    // Concurrent writers may insert the same entry; ON CONFLICT DO NOTHING keeps the caller's transaction alive.
    entry = await em.upsert(
      CustomerDictionaryEntry,
      {
        ...scope,
        value: trimmed,
        label: params.label?.trim() || trimmed,
        color: color ?? null,
        icon: icon ?? null,
        createdAt: now,
        updatedAt: now,
      },
      { onConflictFields: ['organizationId', 'tenantId', 'kind', 'normalizedValue'], onConflictAction: 'ignore' },
    )
    createdKinds?.add(params.kind)
  }
  let changed = false
  if (color !== undefined && entry.color !== color) {
    entry.color = color ?? null
    changed = true
  }
  if (icon !== undefined && entry.icon !== icon) {
    entry.icon = icon ?? null
    changed = true
  }
  if (changed) {
    entry.updatedAt = now
    em.persist(entry)
  }
  return entry
}

export async function invalidateDictionaryKindCaches(
  ctx: CommandRuntimeContext,
  scope: CustomerEntityScope,
  kinds: Iterable<string>,
): Promise<void> {
  const distinctKinds = Array.from(new Set(kinds))
  if (!distinctKinds.length) return
  let cache: CacheStrategy | undefined
  try {
    cache = ctx.container.resolve('cache') as CacheStrategy
  } catch (err) {
    logger.warn('cache resolve failed; skipping dictionary invalidation', { component: 'commands.shared', err })
    return
  }
  for (const mappedKind of distinctKinds) {
    await invalidateDictionaryCache(cache, {
      tenantId: scope.tenantId,
      mappedKind,
      organizationIds: [scope.organizationId],
    })
  }
}

export function resolveParentResourceKind(entityKind: CustomerEntityKind | string | null | undefined): string | null {
  if (entityKind === 'company') return 'customers.company'
  if (entityKind === 'person') return 'customers.person'
  return null
}

export type QueryIndexEventEntry = {
  entityType: string
  recordId: string
  tenantId: string | null
  organizationId: string | null
}

type QueryIndexEventKind = 'delete' | 'upsert'

function normalizeEventEntries(entries: readonly QueryIndexEventEntry[]): QueryIndexEventEntry[] {
  const map = new Map<string, QueryIndexEventEntry>()
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const entityType = String(entry.entityType ?? '')
    const recordId = String(entry.recordId ?? '')
    if (!entityType || !recordId) continue
    const key = [
      entityType,
      recordId,
      entry.organizationId ?? '__org__',
      entry.tenantId ?? '__tenant__',
    ].join('|')
    if (!map.has(key)) {
      map.set(key, {
        entityType,
        recordId,
        organizationId: entry.organizationId ?? null,
        tenantId: entry.tenantId ?? null,
      })
    }
  }
  return Array.from(map.values())
}

async function emitQueryIndexEvents(
  ctx: CommandRuntimeContext,
  entries: readonly QueryIndexEventEntry[],
  kind: QueryIndexEventKind,
): Promise<void> {
  const normalized = normalizeEventEntries(entries)
  if (!normalized.length) return

  let bus: EventBus | null = null
  try {
    bus = ctx.container.resolve<EventBus>('eventBus')
  } catch (err) {
    logger.warn('eventBus resolve failed; skipping query index events', { component: 'commands.shared', err })
    bus = null
  }
  if (!bus) return

  const eventName = kind === 'delete' ? 'query_index.delete_one' : 'query_index.upsert_one'
  const crudAction = kind === 'delete' ? 'deleted' : 'updated'

  await Promise.all(
    normalized.map((entry) =>
      bus!
        .emitEvent(
          eventName,
          {
            entityType: entry.entityType,
            recordId: entry.recordId,
            organizationId: entry.organizationId ?? null,
            tenantId: entry.tenantId ?? null,
            crudAction,
          },
          {
            tenantId: entry.tenantId ?? null,
            organizationId: entry.organizationId ?? null,
          },
        )
        .catch((err) => {
          logger.warn('Query index emitEvent failed', { component: 'commands.shared', entry, err })
          return undefined
        }),
    ),
  )
}

export async function emitQueryIndexDeleteEvents(
  ctx: CommandRuntimeContext,
  entries: readonly QueryIndexEventEntry[],
): Promise<void> {
  await emitQueryIndexEvents(ctx, entries, 'delete')
}

export async function emitQueryIndexUpsertEvents(
  ctx: CommandRuntimeContext,
  entries: readonly QueryIndexEventEntry[],
): Promise<void> {
  await emitQueryIndexEvents(ctx, entries, 'upsert')
}
