import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId, emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { resolveRedoSnapshot, restoreCreatedRow, reviveSnapshotSeed } from '@open-mercato/shared/lib/commands/redo'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError, conflict, forbidden, isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { Currency, ExchangeRate } from '../data/entities'
import {
  currencyCreateSchema,
  currencyUpdateSchema,
  currencyDeleteSchema,
  type CurrencyCreateInput,
  type CurrencyUpdateInput,
  type CurrencyDeleteInput,
} from '../data/validators'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { buildCurrencyCommandWhere, ensureCurrencyCommandScope } from './scope'

const currencyCrudEvents: CrudEventsConfig = {
  module: 'currencies',
  entity: 'currency',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

type CurrencySnapshot = {
  id: string
  organizationId: string
  tenantId: string
  code: string
  name: string
  symbol: string | null
  decimalPlaces: number
  thousandsSeparator: string | null
  decimalSeparator: string | null
  isBase: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}

async function loadCurrencySnapshot(
  em: EntityManager,
  id: string,
  ctx: Parameters<typeof buildCurrencyCommandWhere>[0],
): Promise<CurrencySnapshot | null> {
  const record = await em.findOne(
    Currency,
    buildCurrencyCommandWhere<Currency>(ctx, { id }),
  )
  if (!record) return null
  ensureCurrencyCommandScope(ctx, record)
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    code: record.code,
    name: record.name,
    symbol: record.symbol ?? null,
    decimalPlaces: record.decimalPlaces,
    thousandsSeparator: record.thousandsSeparator ?? null,
    decimalSeparator: record.decimalSeparator ?? null,
    isBase: !!record.isBase,
    isActive: !!record.isActive,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

type CurrencyScope = {
  tenantId: string
  organizationId: string
}

type BaseCurrencyTransition = {
  promoted: boolean
  demotedBaseCurrencyIds: string[]
}

type CurrencyCommandResult = {
  currencyId: string
  base?: BaseCurrencyTransition
}

type CurrencyUndoPayload = UndoPayload<CurrencySnapshot> & {
  base?: BaseCurrencyTransition
}

const NO_BASE_TRANSITION: BaseCurrencyTransition = { promoted: false, demotedBaseCurrencyIds: [] }

const BASE_CURRENCY_LOCK_SQL = 'select pg_advisory_xact_lock(hashtextextended(?, 0))'

const UPDATABLE_CURRENCY_FIELDS = [
  'code',
  'name',
  'symbol',
  'decimalPlaces',
  'thousandsSeparator',
  'decimalSeparator',
  'isBase',
  'isActive',
] as const

function baseCurrencyLockKey(scope: CurrencyScope): string {
  return `currencies:base:${scope.tenantId}:${scope.organizationId}`
}

/**
 * Serialize every currency write inside one tenant and organization so the
 * "exactly one live base currency" invariant is decided on fresh rows. The
 * transaction owns the lock, so PostgreSQL releases it on commit/rollback.
 */
async function lockBaseCurrencyScope(em: EntityManager, scope: CurrencyScope): Promise<void> {
  if (!em.isInTransaction()) {
    throw new Error('[internal] Currency base lock requires an active transaction')
  }
  await em.execute(BASE_CURRENCY_LOCK_SQL, [baseCurrencyLockKey(scope)])
}

async function findLiveBaseCurrencyIds(
  em: EntityManager,
  scope: CurrencyScope,
  excludeId?: string,
): Promise<string[]> {
  const rows = await em.find(
    Currency,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      isBase: true,
      deletedAt: null,
      ...(excludeId ? { id: { $ne: excludeId } } : {}),
    },
    { orderBy: { createdAt: 'asc', id: 'asc' } },
  )
  return rows.map((row) => row.id)
}

async function setBaseFlag(
  em: EntityManager,
  scope: CurrencyScope,
  ids: string[],
  isBase: boolean,
): Promise<void> {
  if (ids.length === 0) return
  await em.nativeUpdate(
    Currency,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      id: { $in: ids },
    },
    { isBase, updatedAt: new Date() },
  )
}

async function findFirstLivePredecessorId(
  em: EntityManager,
  scope: CurrencyScope,
  candidateIds: string[],
): Promise<string | null> {
  if (candidateIds.length === 0) return null
  const rows = await em.find(Currency, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    id: { $in: candidateIds },
    deletedAt: null,
  })
  const liveIds = new Set(rows.map((row) => row.id))
  return candidateIds.find((id) => liveIds.has(id)) ?? null
}

async function translatedHttpError(status: number, key: string, fallback: string): Promise<CrudHttpError> {
  const { translate } = await resolveTranslations()
  return new CrudHttpError(status, { error: translate(key, fallback) })
}

async function resolvePredecessorOrRefuse(
  em: EntityManager,
  scope: CurrencyScope,
  candidateIds: string[],
): Promise<string> {
  const predecessorId = await findFirstLivePredecessorId(em, scope, candidateIds)
  if (!predecessorId) {
    throw await translatedHttpError(
      409,
      'currencies.errors.undoWouldClearBase',
      "This change can't be undone because it would leave the organization without a base currency.",
    )
  }
  return predecessorId
}

function countActiveRatesForCode(em: EntityManager, scope: CurrencyScope, code: string): Promise<number> {
  return em.count(ExchangeRate, {
    $or: [
      { fromCurrencyCode: code },
      { toCurrencyCode: code },
    ],
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
    isActive: true,
  })
}

function readScopedSnapshotRecord(em: EntityManager, snapshot: CurrencySnapshot): Promise<Currency | null> {
  return em.findOne(Currency, {
    id: snapshot.id,
    tenantId: snapshot.tenantId,
    organizationId: snapshot.organizationId,
  })
}

function scopeOf(record: CurrencyScope): CurrencyScope {
  return { tenantId: record.tenantId, organizationId: record.organizationId }
}

function omitIsBase(input: CurrencyUpdateInput): Partial<CurrencyUpdateInput> {
  const rest: Partial<CurrencyUpdateInput> = { ...input }
  delete rest.isBase
  return rest
}

function isPromotionByLegacyLog(payload: CurrencyUndoPayload | null): boolean {
  return payload?.before?.isBase === false && payload?.after?.isBase === true
}

function isDemotionByLegacyLog(payload: CurrencyUndoPayload | null): boolean {
  return !payload?.base && payload?.before?.isBase === true && payload?.after?.isBase === false
}

const createCurrencyCommand: CommandHandler<CurrencyCreateInput, CurrencyCommandResult> = {
  id: 'currencies.currencies.create',
  async execute(input, ctx) {
    const parsed = currencyCreateSchema.parse(input)
    ensureCurrencyCommandScope(ctx, parsed)

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    if (ctx.auth && ctx.auth.isSuperAdmin !== true) {
      const organization = await em.findOne(
        Organization,
        { id: parsed.organizationId, deletedAt: null },
        { populate: ['tenant'] },
      )
      if (!organization || String(organization.tenant.id) !== parsed.tenantId) {
        throw forbidden()
      }
    }

    const scope = scopeOf(parsed)
    let demotedBaseCurrencyIds: string[] = []
    let record!: Currency

    try {
      await withAtomicFlush(
        em,
        [
          async () => {
            await lockBaseCurrencyScope(em, scope)
            const existing = await em.findOne(Currency, {
              code: parsed.code,
              organizationId: parsed.organizationId,
              tenantId: parsed.tenantId,
              deletedAt: null,
            })
            if (existing) {
              throw conflict('Currency code already exists for this organization.')
            }
            if (parsed.isBase) {
              demotedBaseCurrencyIds = await findLiveBaseCurrencyIds(em, scope)
              await setBaseFlag(em, scope, demotedBaseCurrencyIds, false)
            }
          },
          () => {
            const now = new Date()
            record = em.create(Currency, {
              organizationId: parsed.organizationId,
              tenantId: parsed.tenantId,
              code: parsed.code,
              name: parsed.name,
              symbol: parsed.symbol ?? null,
              decimalPlaces: parsed.decimalPlaces ?? 2,
              thousandsSeparator: parsed.thousandsSeparator ?? null,
              decimalSeparator: parsed.decimalSeparator ?? null,
              isBase: parsed.isBase ?? false,
              isActive: parsed.isActive !== false,
              createdAt: now,
              updatedAt: now,
            })
            em.persist(record)
          },
        ],
        { transaction: true },
      )
    } catch (err) {
      if (isUniqueViolation(err, 'currencies_code_scope_unique')) {
        throw conflict('Currency code already exists for this organization.')
      }
      throw err
    }

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      events: currencyCrudEvents,
    })

    return record.isBase
      ? { currencyId: record.id, base: { promoted: true, demotedBaseCurrencyIds } }
      : { currencyId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadCurrencySnapshot(em, result.currencyId, ctx)
  },
  buildLog: async ({ snapshots, result }) => {
    const after = snapshots.after as CurrencySnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('currencies.audit.create', 'Create currency'),
      resourceKind: 'currencies.currency',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: { undo: { after, base: result?.base ?? NO_BASE_TRANSITION } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<CurrencyUndoPayload>(logEntry)
    const after = payload?.after ?? null
    if (!after) return
    const scope = scopeOf(after)
    const promoted = payload?.base ? payload.base.promoted : after.isBase
    const predecessorIds = payload?.base?.demotedBaseCurrencyIds ?? []
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record: Currency | null = null
    let restoredBaseId: string | null = null

    await withAtomicFlush(
      em,
      [
        async () => {
          await lockBaseCurrencyScope(em, scope)
          const current = await readScopedSnapshotRecord(em, after)
          if (!current || current.deletedAt) return
          const activeRatesCount = await countActiveRatesForCode(em, scope, current.code)
          if (activeRatesCount > 0) {
            throw await translatedHttpError(
              409,
              'currencies.errors.undoHasRates',
              "This change can't be undone because exchange rates now use this currency. Delete or deactivate those exchange rates first.",
            )
          }
          if (current.isBase) {
            restoredBaseId = await resolvePredecessorOrRefuse(em, scope, promoted ? predecessorIds : [])
          }
          record = current
        },
        () => {
          if (!record) return
          record.deletedAt = new Date()
          record.isActive = false
          record.isBase = false
        },
        () => (restoredBaseId ? setBaseFlag(em, scope, [restoredBaseId], true) : undefined),
      ],
      { transaction: true },
    )
  },
  redo: async ({ ctx, logEntry }) => {
    const snapshot = resolveRedoSnapshot<CurrencySnapshot>(logEntry)
    if (!snapshot || !snapshot.id) {
      throw new CrudHttpError(400, { error: '[internal] redo snapshot unavailable for create command' })
    }
    const scope = scopeOf(snapshot)
    const isBase = snapshot.isBase === true
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let demotedBaseCurrencyIds: string[] = []
    let record!: Currency

    try {
      await withAtomicFlush(
        em,
        [
          async () => {
            await lockBaseCurrencyScope(em, scope)
            if (isBase) {
              demotedBaseCurrencyIds = await findLiveBaseCurrencyIds(em, scope, snapshot.id)
              await setBaseFlag(em, scope, demotedBaseCurrencyIds, false)
            }
          },
          async () => {
            record = await restoreCreatedRow(
              em,
              Currency,
              snapshot.id,
              () => reviveSnapshotSeed(snapshot as unknown as Record<string, unknown>),
              (lookupEm) => readScopedSnapshotRecord(lookupEm, snapshot),
            )
            record.isBase = isBase
          },
        ],
        { transaction: true },
      )
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw conflict('[internal] Cannot redo: a record with the same unique key already exists.')
      }
      throw err
    }

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      events: currencyCrudEvents,
    })

    return isBase
      ? { currencyId: record.id, base: { promoted: true, demotedBaseCurrencyIds } }
      : { currencyId: record.id }
  },
}

const updateCurrencyCommand: CommandHandler<CurrencyUpdateInput, CurrencyCommandResult> = {
  id: 'currencies.currencies.update',
  async prepare(input, ctx) {
    requireId(input.id, 'Currency ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const before = await loadCurrencySnapshot(em, input.id, ctx)
    return { before }
  },
  async execute(input, ctx) {
    const parsed = currencyUpdateSchema.parse(input)
    requireId(parsed.id, 'Currency ID is required')

    const scopeRecord = await (ctx.container.resolve('em') as EntityManager).fork().findOne(
      Currency,
      buildCurrencyCommandWhere<Currency>(ctx, { id: parsed.id }),
    )
    if (!scopeRecord) {
      throw new CrudHttpError(404, { error: 'Currency not found' })
    }
    ensureCurrencyCommandScope(ctx, scopeRecord)
    const scope = scopeOf(scopeRecord)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record!: Currency
    let changes: Record<string, { from: unknown; to: unknown }> = {}
    let promoted = false
    let demotedBaseCurrencyIds: string[] = []

    await withAtomicFlush(
      em,
      [
        async () => {
          await lockBaseCurrencyScope(em, scope)
          const current = await em.findOne(
            Currency,
            buildCurrencyCommandWhere<Currency>(ctx, { id: parsed.id }),
          )
          if (!current) {
            throw new CrudHttpError(404, { error: 'Currency not found' })
          }
          ensureCurrencyCommandScope(ctx, current)
          record = current

          if (parsed.code && parsed.code !== record.code) {
            const existing = await em.findOne(Currency, {
              code: parsed.code,
              organizationId: record.organizationId,
              tenantId: record.tenantId,
              id: { $ne: record.id },
              deletedAt: null,
            })
            if (existing) {
              throw conflict('Currency code already exists for this organization.')
            }
          }

          if (parsed.isBase === false && record.isBase) {
            throw await translatedHttpError(
              400,
              'currencies.errors.baseCurrencyUnset',
              'Choose another currency as the base instead of clearing it.',
            )
          }

          const allChanges = buildChanges(
            record as unknown as Record<string, unknown>,
            parsed,
            UPDATABLE_CURRENCY_FIELDS,
          )
          changes = Object.fromEntries(
            Object.entries(allChanges).filter(([, change]) => change.to !== undefined),
          ) as Record<string, { from: unknown; to: unknown }>

          promoted = changes.isBase?.to === true
          if (promoted) {
            demotedBaseCurrencyIds = await findLiveBaseCurrencyIds(em, scope, record.id)
          }
        },
        () => {
          if (Object.keys(changes).length === 0) return
          const assignments = Object.fromEntries(
            Object.entries(changes).map(([key, change]) => [key, change.to]),
          )
          Object.assign(record, assignments, { updatedAt: new Date() })
        },
        () => setBaseFlag(em, scope, demotedBaseCurrencyIds, false),
      ],
      { transaction: true },
    )

    const result: CurrencyCommandResult = promoted
      ? { currencyId: record.id, base: { promoted: true, demotedBaseCurrencyIds } }
      : { currencyId: record.id }
    if (Object.keys(changes).length === 0) {
      return result
    }

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      events: currencyCrudEvents,
    })

    return result
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadCurrencySnapshot(em, result.currencyId, ctx)
  },
  buildLog: async ({ input, snapshots, result }) => {
    const before = snapshots.before as CurrencySnapshot | undefined
    const after = snapshots.after as CurrencySnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    const base = result?.base ?? NO_BASE_TRANSITION
    return {
      actionLabel: translate('currencies.audit.update', 'Update currency'),
      resourceKind: 'currencies.currency',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotBefore: before ?? undefined,
      snapshotAfter: after,
      payload: { undo: { before, after, base } },
      redoInput: base.promoted ? input : omitIsBase(input),
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<CurrencyUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const scope = scopeOf(before)
    const promoted = payload?.base ? payload.base.promoted : isPromotionByLegacyLog(payload)
    const predecessorIds = payload?.base?.demotedBaseCurrencyIds ?? []
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const demotedByLegacyLog = isDemotionByLegacyLog(payload)
    let record: Currency | null = null
    let restoredBaseId: string | null = null
    let repromote = false

    await withAtomicFlush(
      em,
      [
        async () => {
          await lockBaseCurrencyScope(em, scope)
          const current = await readScopedSnapshotRecord(em, before)
          if (!current) return
          if (promoted && current.isBase && !current.deletedAt) {
            restoredBaseId = await resolvePredecessorOrRefuse(em, scope, predecessorIds)
          }
          if (demotedByLegacyLog && !current.isBase && !current.deletedAt) {
            repromote = (await findLiveBaseCurrencyIds(em, scope)).length === 0
          }
          record = current
        },
        () => {
          if (!record) return
          Object.assign(record, {
            code: before.code,
            name: before.name,
            symbol: before.symbol,
            decimalPlaces: before.decimalPlaces,
            thousandsSeparator: before.thousandsSeparator,
            decimalSeparator: before.decimalSeparator,
            isActive: before.isActive,
            updatedAt: new Date(),
          })
          if (restoredBaseId) record.isBase = false
          if (repromote) record.isBase = true
        },
        () => (restoredBaseId ? setBaseFlag(em, scope, [restoredBaseId], true) : undefined),
      ],
      { transaction: true },
    )
  },
}

const deleteCurrencyCommand: CommandHandler<CurrencyDeleteInput, { currencyId: string }> = {
  id: 'currencies.currencies.delete',
  async prepare(input, ctx) {
    requireId(input.id, 'Currency ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const before = await loadCurrencySnapshot(em, input.id, ctx)
    return { before }
  },
  async execute(input, ctx) {
    const parsed = currencyDeleteSchema.parse(input)
    requireId(parsed.id, 'Currency ID is required')

    const scopeRecord = await (ctx.container.resolve('em') as EntityManager).fork().findOne(
      Currency,
      buildCurrencyCommandWhere<Currency>(ctx, { id: parsed.id }),
    )
    if (!scopeRecord) {
      throw new CrudHttpError(404, { error: 'Currency not found' })
    }
    ensureCurrencyCommandScope(ctx, scopeRecord)
    const scope = scopeOf(scopeRecord)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record!: Currency

    await withAtomicFlush(
      em,
      [
        async () => {
          await lockBaseCurrencyScope(em, scope)
          const current = await em.findOne(
            Currency,
            buildCurrencyCommandWhere<Currency>(ctx, { id: parsed.id }),
          )
          if (!current) {
            throw new CrudHttpError(404, { error: 'Currency not found' })
          }
          ensureCurrencyCommandScope(ctx, current)

          if (current.isBase) {
            throw new CrudHttpError(400, { error: 'Cannot delete the base currency' })
          }

          const activeRatesCount = await countActiveRatesForCode(em, scope, current.code)
          if (activeRatesCount > 0) {
            throw new CrudHttpError(400, {
              error: `Cannot delete currency ${current.code} because it has ${activeRatesCount} active exchange rate(s). Please delete or deactivate the exchange rates first.`,
            })
          }
          record = current
        },
        () => {
          record.deletedAt = new Date()
          record.isActive = false
        },
      ],
      { transaction: true },
    )

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      events: currencyCrudEvents,
    })

    return { currencyId: record.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as CurrencySnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('currencies.audit.delete', 'Delete currency'),
      resourceKind: 'currencies.currency',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<CurrencyUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const scope = scopeOf(before)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record: Currency | null = null
    let reviveAsNonBase = false

    await withAtomicFlush(
      em,
      [
        async () => {
          await lockBaseCurrencyScope(em, scope)
          const current = await readScopedSnapshotRecord(em, before)
          if (!current) return
          if (current.isBase) {
            const otherBaseIds = await findLiveBaseCurrencyIds(em, scope, current.id)
            reviveAsNonBase = otherBaseIds.length > 0
          }
          record = current
        },
        () => {
          if (!record) return
          record.deletedAt = null
          record.isActive = before.isActive
          if (reviveAsNonBase) record.isBase = false
          record.updatedAt = new Date()
        },
      ],
      { transaction: true },
    )
  },
}

registerCommand(createCurrencyCommand)
registerCommand(updateCurrencyCommand)
registerCommand(deleteCurrencyCommand)

export { createCurrencyCommand, updateCurrencyCommand, deleteCurrencyCommand }
