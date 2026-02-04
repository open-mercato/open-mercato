import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
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
  isActive: boolean
  createdAt: string
  updatedAt: string
}

type ExchangeRateUndoPayload = UndoPayload<ExchangeRateSnapshot>

async function loadExchangeRateSnapshot(em: EntityManager, id: string): Promise<ExchangeRateSnapshot | null> {
  const record = await em.findOne(ExchangeRate, { id })
  if (!record) return null
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

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    // Validate currencies exist
    await validateCurrenciesExist(em, parsed.fromCurrencyCode, parsed.toCurrencyCode, parsed.organizationId, parsed.tenantId)

    // Check for duplicate rate (same pair + date + source)
    const existing = await em.findOne(ExchangeRate, {
      fromCurrencyCode: parsed.fromCurrencyCode,
      toCurrencyCode: parsed.toCurrencyCode,
      date: parsed.date,
      source: parsed.source,
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      deletedAt: null,
    })
    if (existing) {
      throw new CrudHttpError(400, {
        error: 'Exchange rate for this currency pair, date, and source already exists',
      })
    }

    const now = new Date()
    const record = em.create(ExchangeRate, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      fromCurrencyCode: parsed.fromCurrencyCode,
      toCurrencyCode: parsed.toCurrencyCode,
      rate: parsed.rate,
      date: parsed.date,
      source: parsed.source,
      type: parsed.type ?? null,
      isActive: parsed.isActive !== false,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(record)
    await em.flush()

    return { exchangeRateId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve('em') as EntityManager
    return loadExchangeRateSnapshot(em, result.exchangeRateId)
  },
  buildLog: async ({ result, ctx }) => {
    const em = ctx.container.resolve('em') as EntityManager
    const after = await loadExchangeRateSnapshot(em, result.exchangeRateId)
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
    const record = await em.findOne(ExchangeRate, { id: after.id })
    if (!record) return
    record.deletedAt = new Date()
    record.isActive = false
    await em.flush()
  },
}

const updateExchangeRateCommand: CommandHandler<ExchangeRateUpdateInput, { exchangeRateId: string }> = {
  id: 'currencies.exchange_rates.update',
  async prepare(input, ctx) {
    requireId(input.id, 'Exchange rate ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const before = await loadExchangeRateSnapshot(em, input.id)
    return { before }
  },
  async execute(input, ctx) {
    const parsed = exchangeRateUpdateSchema.parse(input)
    requireId(parsed.id, 'Exchange rate ID is required')

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ExchangeRate, { id: parsed.id, deletedAt: null })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Exchange rate not found' })
    }

    // Validate currencies if changed
    const fromCode = parsed.fromCurrencyCode ?? record.fromCurrencyCode
    const toCode = parsed.toCurrencyCode ?? record.toCurrencyCode
    if (parsed.fromCurrencyCode || parsed.toCurrencyCode) {
      await validateCurrenciesExist(em, fromCode, toCode, record.organizationId, record.tenantId)
    }

    // Check for duplicate if changing pair, date, or source
    if (parsed.fromCurrencyCode || parsed.toCurrencyCode || parsed.date || parsed.source) {
      const date = parsed.date ?? record.date
      const source = parsed.source ?? record.source
      const existing = await em.findOne(ExchangeRate, {
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
        throw new CrudHttpError(400, {
          error: 'Exchange rate for this currency pair, date, and source already exists',
        })
      }
    }

    const changes = buildChanges(record as unknown as Record<string, unknown>, parsed, [
      'fromCurrencyCode',
      'toCurrencyCode',
      'rate',
      'date',
      'source',
      'type',
      'isActive',
    ])

    if (Object.keys(changes).length === 0) {
      return { exchangeRateId: record.id }
    }

    for (const [key, change] of Object.entries(
      changes as Record<string, { from: unknown; to: unknown }>,
    )) {
      ;(record as any)[key] = change.to
    }
    record.updatedAt = new Date()
    
    // Validate final state after merging changes
    if (record.fromCurrencyCode === record.toCurrencyCode) {
      throw new CrudHttpError(400, { error: 'From and To currencies must be different' })
    }
    
    const rateValue = parseFloat(record.rate)
    if (isNaN(rateValue) || rateValue <= 0) {
      throw new CrudHttpError(400, { error: 'Rate must be greater than zero' })
    }
    
    await em.flush()

    return { exchangeRateId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve('em') as EntityManager
    return loadExchangeRateSnapshot(em, result.exchangeRateId)
  },
  buildLog: async ({ snapshots, result }) => {
    const before = snapshots.before as ExchangeRateSnapshot | undefined
    const after = snapshots.after as ExchangeRateSnapshot | undefined
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
      payload: { undo: { before, after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ExchangeRateUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ExchangeRate, { id: before.id })
    if (!record) return
    Object.assign(record, {
      fromCurrencyCode: before.fromCurrencyCode,
      toCurrencyCode: before.toCurrencyCode,
      rate: before.rate,
      date: new Date(before.date),
      source: before.source,
      type: before.type,
      isActive: before.isActive,
      updatedAt: new Date(),
    })
    await em.flush()
  },
}

const deleteExchangeRateCommand: CommandHandler<ExchangeRateDeleteInput, { exchangeRateId: string }> = {
  id: 'currencies.exchange_rates.delete',
  async prepare(input, ctx) {
    requireId(input.id, 'Exchange rate ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const before = await loadExchangeRateSnapshot(em, input.id)
    return { before }
  },
  async execute(input, ctx) {
    const parsed = exchangeRateDeleteSchema.parse(input)
    requireId(parsed.id, 'Exchange rate ID is required')

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(ExchangeRate, { id: parsed.id, deletedAt: null })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Exchange rate not found' })
    }

    record.deletedAt = new Date()
    record.isActive = false
    await em.flush()

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
    const record = await em.findOne(ExchangeRate, { id: before.id })
    if (!record) return
    record.deletedAt = null
    record.isActive = before.isActive
    record.updatedAt = new Date()
    await em.flush()
  },
}

registerCommand(createExchangeRateCommand)
registerCommand(updateExchangeRateCommand)
registerCommand(deleteExchangeRateCommand)

export { createExchangeRateCommand, updateExchangeRateCommand, deleteExchangeRateCommand }
