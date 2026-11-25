import { getTransactionLifetime, onTransactionLifetimeComplete, registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId, emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { makeCreateRedo } from '@open-mercato/shared/lib/commands/redo'
import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import { isDeepStrictEqual } from 'node:util'
import { CrudHttpError, conflict, isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { ExchangeRate, Currency } from '../data/entities'
import {
  exchangeRateCreateSchema,
  exchangeRateUpdateSchema,
  exchangeRateDeleteSchema,
  type ExchangeRateCreateInput,
  type ExchangeRateUpdateInput,
  type ExchangeRateDeleteInput,
} from '../data/validators'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { buildCurrencyCommandWhere, ensureCurrencyCommandScope } from './scope'
import { isDecimalInput, toDecimal } from '@open-mercato/shared/lib/decimal'
import { NBP_AVERAGE_PROVIDER_SOURCE } from '../services/providers/nbpAverage'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const exchangeRateCrudEvents: CrudEventsConfig = {
  module: 'currencies',
  entity: 'exchange_rate',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

type ExchangeRateSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  fromCurrencyCode: string
  toCurrencyCode: string
  rate: string
  date: string
  source: string
  type: string | null
  externalReference: string | null
  metadata: Record<string, unknown> | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

type ExchangeRateUndoPayload = UndoPayload<ExchangeRateSnapshot>
type ExchangeRateUpdateUndoPayload = ExchangeRateUndoPayload & { restoredBeforeUpdatedAt?: string }
type ExchangeRateResult = { exchangeRateId: string }
const lockedUpdateSnapshots = new WeakMap<ExchangeRateResult, ExchangeRateUpdateUndoPayload>()

async function withExchangeRateWrite<Result>(
  ctx: CommandRuntimeContext,
  write: (em: EntityManager) => Promise<Result>,
): Promise<Result> {
  if (ctx.transactionalEm) return write(ctx.transactionalEm)
  return (ctx.container.resolve('em') as EntityManager).fork().transactional(write)
}

async function afterExchangeRateWrite(ctx: CommandRuntimeContext, notify: () => Promise<void>): Promise<void> {
  const em = ctx.transactionalEm
  if (em && getTransactionLifetime(em)) {
    onTransactionLifetimeComplete(em, async (outcome) => {
      if (outcome === 'committed') await notify()
    })
    return
  }
  await notify()
}

async function loadExchangeRateSnapshot(
  em: EntityManager,
  id: string,
  ctx: Parameters<typeof buildCurrencyCommandWhere>[0],
): Promise<ExchangeRateSnapshot | null> {
  const record = await em.findOne(
    ExchangeRate,
    buildCurrencyCommandWhere<ExchangeRate>(ctx, { id }),
  )
  if (!record) return null
  ensureCurrencyCommandScope(ctx, record)
  return exchangeRateSnapshot(record)
}

async function lockExchangeRate(
  em: EntityManager,
  id: string,
  ctx: Parameters<typeof buildCurrencyCommandWhere>[0],
  includeDeleted = false,
): Promise<ExchangeRate | null> {
  const where = buildCurrencyCommandWhere<ExchangeRate>(ctx, { id })
  if (includeDeleted && typeof where === 'object' && where !== null && 'deletedAt' in where) delete where.deletedAt
  const record = await findOneWithDecryption(
    em,
    ExchangeRate,
    where,
    { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
    { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null },
  )
  if (record) ensureCurrencyCommandScope(ctx, record)
  return record
}

function restoredUpdatedAt(record: ExchangeRate): string | undefined {
  const lineage = record.undoLineage
  if (lineage?.writtenUpdatedAt === record.updatedAt.toISOString()) return lineage.restoredUpdatedAt
}

function exchangeRateSnapshot(record: ExchangeRate): ExchangeRateSnapshot {
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    fromCurrencyCode: record.fromCurrencyCode,
    toCurrencyCode: record.toCurrencyCode,
    rate: record.rate,
    date: record.date.toISOString(),
    source: record.source,
    type: record.type ?? null,
    externalReference: record.externalReference ?? null,
    metadata: record.metadata ?? null,
    isActive: !!record.isActive,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

async function validateCurrenciesExist(
  em: EntityManager,
  fromCode: string,
  toCode: string,
  organizationId: string,
  tenantId: string
): Promise<void> {
  const fromCurrency = await em.findOne(Currency, {
    code: fromCode,
    organizationId,
    tenantId,
    deletedAt: null,
  })
  if (!fromCurrency) {
    throw new CrudHttpError(400, { error: `From currency ${fromCode} does not exist or is inactive` })
  }

  const toCurrency = await em.findOne(Currency, {
    code: toCode,
    organizationId,
    tenantId,
    deletedAt: null,
  })
  if (!toCurrency) {
    throw new CrudHttpError(400, { error: `To currency ${toCode} does not exist or is inactive` })
  }
}

const createExchangeRateCommand: CommandHandler<ExchangeRateCreateInput, { exchangeRateId: string }> = {
  id: 'currencies.exchange_rates.create',
  async execute(input, ctx) {
    const parsed = exchangeRateCreateSchema.parse(input)
    ensureCurrencyCommandScope(ctx, parsed)
    const source = parsed.source === NBP_AVERAGE_PROVIDER_SOURCE ? 'manual' : parsed.source

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    // Validate currencies exist
    await validateCurrenciesExist(em, parsed.fromCurrencyCode, parsed.toCurrencyCode, parsed.organizationId, parsed.tenantId)

    // Check for duplicate rate (same pair + date + source)
    const existing = await em.findOne(ExchangeRate, {
      fromCurrencyCode: parsed.fromCurrencyCode,
      toCurrencyCode: parsed.toCurrencyCode,
      date: parsed.date,
      source,
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      deletedAt: null,
    })
    if (existing) {
      throw conflict('Exchange rate for this currency pair, date, and source already exists')
    }

    const now = new Date()
    const record = em.create(ExchangeRate, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      fromCurrencyCode: parsed.fromCurrencyCode,
      toCurrencyCode: parsed.toCurrencyCode,
      rate: parsed.rate,
      date: parsed.date,
      source,
      type: parsed.type ?? null,
      externalReference: null,
      metadata: parsed.metadata ?? null,
      isActive: parsed.isActive !== false,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(record)
    try {
      await em.flush()
    } catch (err) {
      if (isUniqueViolation(err, 'exchange_rates_pair_datetime_source_unique')) {
        throw conflict('Exchange rate for this currency pair, date, and source already exists')
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
      events: exchangeRateCrudEvents,
    })

    return { exchangeRateId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadExchangeRateSnapshot(em, result.exchangeRateId, ctx)
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as ExchangeRateSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('currencies.rates.audit.create', 'Create exchange rate'),
      resourceKind: 'currencies.exchange_rate',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: { undo: { after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ExchangeRateUndoPayload>(logEntry)
    const after = payload?.after ?? null
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await em.transactional(async (transactionEm) => {
      const record = await lockExchangeRate(transactionEm, after.id, ctx, true)
      if (!record) return
      record.deletedAt = new Date()
      record.isActive = false
      record.undoLineage = null
      await transactionEm.flush()
    })
  },
  redo: makeCreateRedo<ExchangeRate, ExchangeRateSnapshot, ExchangeRateCreateInput, { exchangeRateId: string }>({
    entityClass: ExchangeRate,
    dateFields: ['createdAt', 'updatedAt', 'deletedAt', 'date'],
    buildResult: (entity) => ({ exchangeRateId: entity.id }),
    events: exchangeRateCrudEvents,
    transaction: true,
    findRow: ({ em, ctx, id }) => lockExchangeRate(em, id, ctx, true),
    afterRestore: ({ entity }) => { entity.undoLineage = null },
  }),
}

const updateExchangeRateCommand: CommandHandler<ExchangeRateUpdateInput, ExchangeRateResult> = {
  id: 'currencies.exchange_rates.update',
  atomicReplay: true,
  async execute(input, ctx) {
    const parsed = exchangeRateUpdateSchema.parse(input)
    requireId(parsed.id, 'Exchange rate ID is required')

    const { record, snapshots, changed } = await withExchangeRateWrite(ctx, async (transactionEm) => {
      await ctx.beforeTransactionalWrite?.(transactionEm, parsed)
      const record = await lockExchangeRate(transactionEm, parsed.id, ctx)
      if (!record) throw new CrudHttpError(404, { error: 'Exchange rate not found' })
      const before = exchangeRateSnapshot(record)
      const restoredBeforeUpdatedAt = restoredUpdatedAt(record)

      // Validate currencies if changed
      const fromCode = parsed.fromCurrencyCode ?? record.fromCurrencyCode
      const toCode = parsed.toCurrencyCode ?? record.toCurrencyCode
      const factsChanged = fromCode !== record.fromCurrencyCode
        || toCode !== record.toCurrencyCode
        || (parsed.rate !== undefined && !toDecimal(parsed.rate).eq(toDecimal(record.rate)))
        || (parsed.date !== undefined && parsed.date.getTime() !== record.date.getTime())
        || (parsed.source !== undefined && parsed.source !== record.source)
        || (parsed.type !== undefined && parsed.type !== (record.type ?? null))
      const detachPublication = record.externalReference != null && factsChanged
      const reservesProviderSource = parsed.source === NBP_AVERAGE_PROVIDER_SOURCE && parsed.source !== record.source
      const source = detachPublication || reservesProviderSource ? 'manual' : parsed.source ?? record.source
      if (parsed.fromCurrencyCode || parsed.toCurrencyCode) {
        await validateCurrenciesExist(transactionEm, fromCode, toCode, record.organizationId, record.tenantId)
      }

      // Check for duplicate if changing pair, date, or source
      if (parsed.fromCurrencyCode || parsed.toCurrencyCode || parsed.date || parsed.source || detachPublication) {
        const date = parsed.date ?? record.date
        const existing = await transactionEm.findOne(ExchangeRate, {
          fromCurrencyCode: fromCode,
          toCurrencyCode: toCode,
          date,
          source,
          organizationId: record.organizationId,
          tenantId: record.tenantId,
          id: { $ne: record.id },
          deletedAt: null,
        })
        if (existing) {
          throw conflict('Exchange rate for this currency pair, date, and source already exists')
        }
      }

      const updated = { ...parsed, source, ...(detachPublication ? { externalReference: null } : {}) }
      const allChanges = buildChanges(record as unknown as Record<string, unknown>, updated, [
        'fromCurrencyCode',
        'toCurrencyCode',
        'rate',
        'date',
        'source',
        'type',
        'externalReference',
        'metadata',
        'isActive',
      ])
      const changes = Object.fromEntries(
        Object.entries(allChanges).filter(([, c]) => c.to !== undefined),
      ) as Record<string, { from: unknown; to: unknown }>

      if (Object.keys(changes).length === 0) {
        return { record, snapshots: { before, after: before, restoredBeforeUpdatedAt }, changed: false }
      }

      Object.assign(record, Object.fromEntries(Object.entries(changes).map(([key, change]) => [key, change.to])))
      record.undoLineage = null
      record.updatedAt = new Date(Math.max(Date.now(), record.updatedAt.getTime() + 1))

      // Validate final state after merging changes
      if (record.fromCurrencyCode === record.toCurrencyCode) {
        throw new CrudHttpError(400, { error: 'From and To currencies must be different' })
      }

      if (!isDecimalInput(record.rate) || !toDecimal(record.rate).gt(0)) {
        throw new CrudHttpError(400, { error: 'Rate must be greater than zero' })
      }

      await transactionEm.flush()
      const after = exchangeRateSnapshot(record)
      return { record, snapshots: { before, after, restoredBeforeUpdatedAt }, changed: true }
    })

    const result = { exchangeRateId: record.id }
    lockedUpdateSnapshots.set(result, snapshots)
    if (!changed) return result

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await afterExchangeRateWrite(ctx, () => emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      events: exchangeRateCrudEvents,
    }))

    return result
  },
  captureAfter: (_input, result) => lockedUpdateSnapshots.get(result)?.after,
  buildLog: async ({ result }) => {
    const snapshots = lockedUpdateSnapshots.get(result)
    const before = snapshots?.before
    const after = snapshots?.after
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('currencies.rates.audit.update', 'Update exchange rate'),
      resourceKind: 'currencies.exchange_rate',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotBefore: before ?? undefined,
      snapshotAfter: after,
      payload: { undo: snapshots },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ExchangeRateUpdateUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const { translate } = await resolveTranslations()
    const occupiedMessage = translate('currencies.errors.undoRateKeyOccupied', 'This change cannot be undone because another exchange rate now occupies its original currency pair, date, and source.')
    let record: ExchangeRate | null
    try {
      record = await withExchangeRateWrite(ctx, async (transactionEm) => {
        const current = await lockExchangeRate(transactionEm, before.id, ctx, true)
        if (!current) return null
        const snapshot = exchangeRateSnapshot(current)
        const restoredVersion = restoredUpdatedAt(current)
        const changedSinceEdit = payload?.after && Object.entries(payload.after).some(([field, value]) => (
          field === 'updatedAt'
            ? snapshot.updatedAt !== value && restoredVersion !== value
            : !isDeepStrictEqual(Reflect.get(snapshot, field), value)
        ))
        if (current.deletedAt || changedSinceEdit) {
          throw conflict(translate('currencies.errors.undoRateChanged', 'This change cannot be undone because the exchange rate has changed since this edit.'))
        }
        const occupied = await findOneWithDecryption(transactionEm, ExchangeRate, {
          organizationId: current.organizationId,
          tenantId: current.tenantId,
          fromCurrencyCode: before.fromCurrencyCode,
          toCurrencyCode: before.toCurrencyCode,
          date: new Date(before.date),
          source: before.source,
          id: { $ne: current.id },
        }, undefined, { tenantId: current.tenantId, organizationId: current.organizationId })
        if (occupied) throw conflict(occupiedMessage)
        Object.assign(current, {
          fromCurrencyCode: before.fromCurrencyCode,
          toCurrencyCode: before.toCurrencyCode,
          rate: before.rate,
          date: new Date(before.date),
          source: before.source,
          type: before.type,
          externalReference: before.externalReference,
          metadata: before.metadata ?? null,
          isActive: before.isActive,
          updatedAt: new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)),
          undoLineage: null,
        })
        await transactionEm.flush()
        const previousVersion = payload?.restoredBeforeUpdatedAt ?? before.updatedAt
        if (typeof previousVersion === 'string') {
          const updated = await transactionEm.nativeUpdate(ExchangeRate, {
            id: current.id,
            tenantId: current.tenantId,
            organizationId: current.organizationId,
          }, {
            undoLineage: { restoredUpdatedAt: previousVersion, writtenUpdatedAt: current.updatedAt.toISOString() },
          })
          if (updated !== 1) throw new Error('[internal] Failed to record exchange-rate undo lineage')
        }
        return current
      })
    } catch (err) {
      if (isUniqueViolation(err, 'exchange_rates_pair_datetime_source_unique')) throw conflict(occupiedMessage)
      throw err
    }
    if (!record) return
    await afterExchangeRateWrite(ctx, () => emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'updated',
      entity: record,
      identifiers: { id: record.id, organizationId: record.organizationId, tenantId: record.tenantId },
      events: exchangeRateCrudEvents,
    }))
  },
}

const deleteExchangeRateCommand: CommandHandler<ExchangeRateDeleteInput, { exchangeRateId: string }> = {
  id: 'currencies.exchange_rates.delete',
  async prepare(input, ctx) {
    requireId(input.id, 'Exchange rate ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const before = await loadExchangeRateSnapshot(em, input.id, ctx)
    return { before }
  },
  async execute(input, ctx) {
    const parsed = exchangeRateDeleteSchema.parse(input)
    requireId(parsed.id, 'Exchange rate ID is required')

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.transactional(async (transactionEm) => {
      await ctx.beforeTransactionalWrite?.(transactionEm, parsed)
      const record = await lockExchangeRate(transactionEm, parsed.id, ctx)
      if (!record) throw new CrudHttpError(404, { error: 'Exchange rate not found' })
      record.deletedAt = new Date()
      record.isActive = false
      record.undoLineage = null
      await transactionEm.flush()
      return record
    })

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
      events: exchangeRateCrudEvents,
    })

    return { exchangeRateId: record.id }
  },
  buildLog: async ({ snapshots, result }) => {
    const before = snapshots.before as ExchangeRateSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('currencies.rates.audit.delete', 'Delete exchange rate'),
      resourceKind: 'currencies.exchange_rate',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ExchangeRateUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await em.transactional(async (transactionEm) => {
      const record = await lockExchangeRate(transactionEm, before.id, ctx, true)
      if (!record) return
      record.deletedAt = null
      record.isActive = before.isActive
      record.undoLineage = null
      record.updatedAt = new Date(Math.max(Date.now(), record.updatedAt.getTime() + 1))
      await transactionEm.flush()
    })
  },
}

registerCommand(createExchangeRateCommand)
registerCommand(updateExchangeRateCommand)
registerCommand(deleteExchangeRateCommand)

export { createExchangeRateCommand, updateExchangeRateCommand, deleteExchangeRateCommand }
