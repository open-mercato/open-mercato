import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { makeCreateRedo } from '@open-mercato/shared/lib/commands/redo'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CacheStrategy } from '@open-mercato/cache'
import { conflict, notFound } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { getMarketTemplate } from '@open-mercato/shared/lib/display/templates'
import { MarketDisplayProfile } from '../data/entities'
import {
  marketDisplayProfileCreateSchema,
  marketDisplayProfileUpdateSchema,
  marketDisplayProfileDeleteSchema,
  type MarketDisplayProfileCreateInput,
  type MarketDisplayProfileUpdateInput,
} from '../data/validators'
import { templateToRowValues } from '../lib/seeds'
import { displayProfileCacheTags } from '../lib/resolve-display-profile'
import { buildMarketCommandWhere, ensureMarketCommandScope, resolveMarketScope } from './scope'

const logger = createLogger('markets.commands')

const profileCrudEvents: CrudEventsConfig = {
  module: 'markets',
  entity: 'market_display_profile',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

/**
 * The whole row. The entity has no children, so an update snapshot is simply every scalar, which
 * makes undo a plain restore rather than a diff replay.
 */
type ProfileSnapshot = Record<string, unknown> & {
  id: string
  organizationId: string
  tenantId: string
}

type ProfileUndoPayload = UndoPayload<ProfileSnapshot>

const SNAPSHOT_FIELDS = [
  'code', 'name', 'languageTag', 'currencyCode', 'currencyDisplay', 'decimalSeparator',
  'thousandsSeparator', 'negativeStyle', 'dateFormat', 'dateTimeFormat', 'timeFormat', 'hourCycle',
  'firstDayOfWeek', 'timeZone', 'addressLayout', 'defaultCountryCode', 'subdivisionRequired',
  'postalCodePattern', 'postalCodeLabelKey', 'subdivisionLabelKey', 'addressLine2LabelKey',
  'phoneNationalPattern', 'phoneDefaultDialCode', 'measurementSystem', 'defaultWeightUnit',
  'defaultLengthUnit', 'lengthDisplay', 'paperSize', 'pricePresentation', 'taxLineLabelKey',
  'taxNoteKey', 'isActive',
] as const

function toSnapshot(record: MarketDisplayProfile): ProfileSnapshot {
  const snapshot: ProfileSnapshot = {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    deletedAt: record.deletedAt ? record.deletedAt.toISOString() : null,
  }
  for (const field of SNAPSHOT_FIELDS) {
    snapshot[field] = (record as unknown as Record<string, unknown>)[field] ?? null
  }
  return snapshot
}

function applySnapshot(record: MarketDisplayProfile, snapshot: ProfileSnapshot): void {
  const target = record as unknown as Record<string, unknown>
  for (const field of SNAPSHOT_FIELDS) {
    if (field in snapshot) target[field] = snapshot[field]
  }
  record.deletedAt = typeof snapshot.deletedAt === 'string' ? new Date(snapshot.deletedAt) : null
}

/**
 * Drop the cached profile after the write commits.
 *
 * Outside `withAtomicFlush` and after the transaction, per the cache consistency rule: invalidating
 * inside the flush would let a concurrent read repopulate the cache from the pre-commit state.
 */
async function invalidateProfileCache(
  ctx: CommandRuntimeContext,
  scope: { organizationId: string; tenantId: string },
): Promise<void> {
  try {
    const cache = ctx.container.resolve('cache') as CacheStrategy
    await cache.deleteByTags(displayProfileCacheTags(scope))
  } catch (error) {
    logger.warn('Display profile cache invalidation failed', { err: error })
  }
}

/**
 * Fill a partial request from the seed template its `code` names.
 *
 * An explicitly supplied field always wins; only absent ones come from the template. A `code` with
 * no template (a market an operator invented) passes through untouched, so validation reports the
 * genuinely missing fields rather than a confusing template error.
 */
function withTemplateDefaults(input: unknown): Record<string, unknown> {
  const body = (input ?? {}) as Record<string, unknown>
  const template = getMarketTemplate(typeof body.code === 'string' ? body.code : null)
  if (!template) return body
  const merged: Record<string, unknown> = { ...templateToRowValues(template) }
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) merged[key] = value
  }
  return merged
}

async function loadProfileSnapshot(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  id?: string,
): Promise<ProfileSnapshot | null> {
  const scope = resolveMarketScope(ctx)
  if (!scope) return null
  const where = id
    ? buildMarketCommandWhere<MarketDisplayProfile>(ctx, { id })
    : buildMarketCommandWhere<MarketDisplayProfile>(ctx, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      })
  const record = await em.findOne(MarketDisplayProfile, where)
  if (!record) return null
  ensureMarketCommandScope(ctx, record)
  return toSnapshot(record)
}

const createProfileCommand: CommandHandler<MarketDisplayProfileCreateInput, { profileId: string }> = {
  id: 'markets.market_display_profile.create',
  async execute(input, ctx) {
    // Picking a market is a one-field action: `{ code: 'us' }` is a complete request, and the seed
    // template supplies the rest. Validation still runs over the merged result, so an explicit
    // field is checked exactly as it would be on update.
    const parsed = marketDisplayProfileCreateSchema.parse(withTemplateDefaults(input))
    const scope = resolveMarketScope(ctx)
    if (!scope) throw notFound('Organization scope is required to pick a market.')

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    // Soft-deleted rows included on purpose. The unique constraint is on (organization_id,
    // tenant_id) with no deleted_at predicate, so a cleared market still occupies the scope: an
    // insert would violate it, and clearing a market then picking one again is the documented round
    // trip. A cleared row is revived rather than replaced, which also keeps its id stable for the
    // audit trail.
    const existing = await em.findOne(MarketDisplayProfile, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })
    if (existing && !existing.deletedAt) {
      throw conflict('This organization already has a market display profile.')
    }

    const record = existing ?? em.create(MarketDisplayProfile, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      ...parsed,
      isActive: parsed.isActive !== false,
    } as unknown as MarketDisplayProfile)

    // The mutation belongs INSIDE a phase: `withAtomicFlush` flushes after each phase, so an empty
    // phase list flushes nothing and the row never reaches the database.
    await withAtomicFlush(em, [
      () => {
        if (existing) {
          Object.assign(record, parsed, { deletedAt: null, isActive: parsed.isActive !== false })
        } else {
          em.persist(record)
        }
      },
    ], { transaction: true, label: 'markets.market_display_profile.create' })

    await invalidateProfileCache(ctx, scope)
    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: record,
      identifiers: { id: record.id, organizationId: record.organizationId, tenantId: record.tenantId },
      events: profileCrudEvents,
      indexer: { entityType: 'markets:market_display_profile' },
    })
    return { profileId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadProfileSnapshot(em, ctx, result.profileId)
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as ProfileSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('markets.audit.create', 'Pick market display profile'),
      resourceKind: 'markets.market_display_profile',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: { undo: { after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const after = extractUndoPayload<ProfileUndoPayload>(logEntry)?.after ?? null
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(MarketDisplayProfile, { id: after.id })
    if (!record) return
    record.deletedAt = new Date()
    record.isActive = false
    await em.flush()
    await invalidateProfileCache(ctx, { organizationId: after.organizationId, tenantId: after.tenantId })
  },
  redo: makeCreateRedo<MarketDisplayProfile, ProfileSnapshot, MarketDisplayProfileCreateInput, { profileId: string }>({
    entityClass: MarketDisplayProfile,
    buildResult: (entity) => ({ profileId: entity.id }),
    events: profileCrudEvents,
  }),
}

const updateProfileCommand: CommandHandler<MarketDisplayProfileUpdateInput, { profileId: string }> = {
  id: 'markets.market_display_profile.update',
  async prepare(input, ctx) {
    const em = ctx.container.resolve('em') as EntityManager
    return { before: await loadProfileSnapshot(em, ctx, input.id) }
  },
  async execute(input, ctx) {
    const parsed = marketDisplayProfileUpdateSchema.parse(input)
    const scope = resolveMarketScope(ctx)
    if (!scope) throw notFound('Organization scope is required to change the market.')

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const where = parsed.id
      ? buildMarketCommandWhere<MarketDisplayProfile>(ctx, { id: parsed.id })
      : buildMarketCommandWhere<MarketDisplayProfile>(ctx, {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          deletedAt: null,
        })
    const record = await em.findOne(MarketDisplayProfile, where)
    if (!record) throw notFound('Market display profile not found')
    ensureMarketCommandScope(ctx, record)
    enforceCommandOptimisticLock({
      resourceKind: 'markets.market_display_profile',
      resourceId: record.id,
      current: record.updatedAt,
      request: ctx.request,
    })

    // A partial post falls back to the named seed template, so the settings form can send only the
    // fields the admin touched without the rest reverting to column defaults.
    const template = getMarketTemplate(parsed.code)
    const defaults = template ? templateToRowValues(template) : {}
    const next = { ...defaults } as Record<string, unknown>
    for (const [key, value] of Object.entries(parsed)) {
      if (key === 'id' || value === undefined) continue
      next[key] = value
    }

    await withAtomicFlush(em, [
      () => {
        Object.assign(record, next)
      },
    ], { transaction: true, label: 'markets.market_display_profile.update' })

    await invalidateProfileCache(ctx, { organizationId: record.organizationId, tenantId: record.tenantId })
    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: record,
      identifiers: { id: record.id, organizationId: record.organizationId, tenantId: record.tenantId },
      events: profileCrudEvents,
      indexer: { entityType: 'markets:market_display_profile' },
    })
    return { profileId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadProfileSnapshot(em, ctx, result.profileId)
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as ProfileSnapshot | undefined
    const after = snapshots.after as ProfileSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('markets.audit.update', 'Update market display profile'),
      resourceKind: 'markets.market_display_profile',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotBefore: before ?? null,
      snapshotAfter: after,
      payload: { undo: { before, after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<ProfileUndoPayload>(logEntry)?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(MarketDisplayProfile, { id: before.id })
    if (!record) return
    applySnapshot(record, before)
    await em.flush()
    await invalidateProfileCache(ctx, { organizationId: before.organizationId, tenantId: before.tenantId })
  },
}

const deleteProfileCommand: CommandHandler<{ id?: string }, { profileId: string }> = {
  id: 'markets.market_display_profile.delete',
  async prepare(input, ctx) {
    const em = ctx.container.resolve('em') as EntityManager
    return { before: await loadProfileSnapshot(em, ctx, input.id) }
  },
  async execute(input, ctx) {
    const parsed = marketDisplayProfileDeleteSchema.parse(input)
    const scope = resolveMarketScope(ctx)
    if (!scope) throw notFound('Organization scope is required to clear the market.')

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const where = parsed.id
      ? buildMarketCommandWhere<MarketDisplayProfile>(ctx, { id: parsed.id })
      : buildMarketCommandWhere<MarketDisplayProfile>(ctx, {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          deletedAt: null,
        })
    const record = await em.findOne(MarketDisplayProfile, where)
    if (!record) throw notFound('Market display profile not found')
    ensureMarketCommandScope(ctx, record)
    enforceCommandOptimisticLock({
      resourceKind: 'markets.market_display_profile',
      resourceId: record.id,
      current: record.updatedAt,
      request: ctx.request,
    })

    // Soft delete: the organization returns to the legacy defaults, which is the documented way
    // back out of a market.
    record.deletedAt = new Date()
    record.isActive = false
    await em.flush()

    await invalidateProfileCache(ctx, { organizationId: record.organizationId, tenantId: record.tenantId })
    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: record,
      identifiers: { id: record.id, organizationId: record.organizationId, tenantId: record.tenantId },
      events: profileCrudEvents,
      indexer: { entityType: 'markets:market_display_profile' },
    })
    return { profileId: record.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as ProfileSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('markets.audit.delete', 'Clear market display profile'),
      resourceKind: 'markets.market_display_profile',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<ProfileUndoPayload>(logEntry)?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(MarketDisplayProfile, { id: before.id })
    if (!record) return
    applySnapshot(record, before)
    record.deletedAt = null
    await em.flush()
    await invalidateProfileCache(ctx, { organizationId: before.organizationId, tenantId: before.tenantId })
  },
}

registerCommand(createProfileCommand)
registerCommand(updateProfileCommand)
registerCommand(deleteProfileCommand)

export { createProfileCommand, updateProfileCommand, deleteProfileCommand }
