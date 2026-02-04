import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { Currency, ExchangeRate } from '../data/entities'
import {
  currencyCreateSchema,
  currencyUpdateSchema,
  currencyDeleteSchema,
  type CurrencyCreateInput,
  type CurrencyUpdateInput,
  type CurrencyDeleteInput,
} from '../data/validators'

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

type CurrencyUndoPayload = UndoPayload<CurrencySnapshot>

async function loadCurrencySnapshot(em: EntityManager, id: string): Promise<CurrencySnapshot | null> {
  const record = await em.findOne(Currency, { id })
  if (!record) return null
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

async function enforceBaseCurrency(
  em: EntityManager,
  currencyId: string,
  organizationId: string,
  tenantId: string
): Promise<void> {
  await em.nativeUpdate(
    Currency,
    {
      organizationId,
      tenantId,
      id: { $ne: currencyId },
      isBase: true,
      deletedAt: null,
    },
    { isBase: false, updatedAt: new Date() }
  )
}

const createCurrencyCommand: CommandHandler<CurrencyCreateInput, { currencyId: string }> = {
  id: 'currencies.currencies.create',
  async execute(input, ctx) {
    const parsed = currencyCreateSchema.parse(input)

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    // Check for duplicate code
    const existing = await em.findOne(Currency, {
      code: parsed.code,
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      deletedAt: null,
    })
    if (existing) {
      throw new CrudHttpError(400, { error: 'Currency code already exists for this organization.' })
    }

    const now = new Date()
    const record = em.create(Currency, {
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
    
    // Enforce only one base currency before flush to prevent race conditions
    if (record.isBase) {
      await enforceBaseCurrency(em, record.id, record.organizationId, record.tenantId)
    }
    
    await em.flush()

    return { currencyId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve('em') as EntityManager
    return loadCurrencySnapshot(em, result.currencyId)
  },
  buildLog: async ({ result, ctx }) => {
    const em = ctx.container.resolve('em') as EntityManager
    const after = await loadCurrencySnapshot(em, result.currencyId)
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('currencies.audit.create', 'Create currency'),
      resourceKind: 'currencies.currency',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: { undo: { after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<CurrencyUndoPayload>(logEntry)
    const after = payload?.after ?? null
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(Currency, { id: after.id })
    if (!record) return
    record.deletedAt = new Date()
    record.isActive = false
    await em.flush()
  },
}

const updateCurrencyCommand: CommandHandler<CurrencyUpdateInput, { currencyId: string }> = {
  id: 'currencies.currencies.update',
  async prepare(input, ctx) {
    requireId(input.id, 'Currency ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const before = await loadCurrencySnapshot(em, input.id)
    return { before }
  },
  async execute(input, ctx) {
    const parsed = currencyUpdateSchema.parse(input)
    requireId(parsed.id, 'Currency ID is required')

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(Currency, { id: parsed.id, deletedAt: null })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Currency not found' })
    }

    // Check code uniqueness if changing code
    if (parsed.code && parsed.code !== record.code) {
      const existing = await em.findOne(Currency, {
        code: parsed.code,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
        id: { $ne: record.id },
        deletedAt: null,
      })
      if (existing) {
        throw new CrudHttpError(400, { error: 'Currency code already exists for this organization.' })
      }
    }

    const changes = buildChanges(record as unknown as Record<string, unknown>, parsed, [
      'code',
      'name',
      'symbol',
      'decimalPlaces',
      'thousandsSeparator',
      'decimalSeparator',
      'isBase',
      'isActive',
    ])

    if (Object.keys(changes).length === 0) {
      return { currencyId: record.id }
    }

    for (const [key, change] of Object.entries(
      changes as Record<string, { from: unknown; to: unknown }>,
    )) {
      ;(record as any)[key] = change.to
    }
    record.updatedAt = new Date()
    
    // Enforce only one base currency before flush to prevent race conditions
    if (parsed.isBase === true && record.isBase) {
      await enforceBaseCurrency(em, record.id, record.organizationId, record.tenantId)
    }
    
    await em.flush()

    return { currencyId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve('em') as EntityManager
    return loadCurrencySnapshot(em, result.currencyId)
  },
  buildLog: async ({ snapshots, result }) => {
    const before = snapshots.before as CurrencySnapshot | undefined
    const after = snapshots.after as CurrencySnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('currencies.audit.update', 'Update currency'),
      resourceKind: 'currencies.currency',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotBefore: before ?? undefined,
      snapshotAfter: after,
      payload: { undo: { before, after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<CurrencyUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(Currency, { id: before.id })
    if (!record) return
    Object.assign(record, {
      code: before.code,
      name: before.name,
      symbol: before.symbol,
      decimalPlaces: before.decimalPlaces,
      thousandsSeparator: before.thousandsSeparator,
      decimalSeparator: before.decimalSeparator,
      isBase: before.isBase,
      isActive: before.isActive,
      updatedAt: new Date(),
    })
    await em.flush()
  },
}

const deleteCurrencyCommand: CommandHandler<CurrencyDeleteInput, { currencyId: string }> = {
  id: 'currencies.currencies.delete',
  async prepare(input, ctx) {
    requireId(input.id, 'Currency ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const before = await loadCurrencySnapshot(em, input.id)
    return { before }
  },
  async execute(input, ctx) {
    const parsed = currencyDeleteSchema.parse(input)
    requireId(parsed.id, 'Currency ID is required')

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(Currency, { id: parsed.id, deletedAt: null })
    if (!record) {
      throw new CrudHttpError(404, { error: 'Currency not found' })
    }

    // Prevent deleting base currency
    if (record.isBase) {
      throw new CrudHttpError(400, { error: 'Cannot delete the base currency' })
    }

    // Prevent deleting currency with active exchange rates
    const activeRatesCount = await em.count(ExchangeRate, {
      $or: [
        { fromCurrencyCode: record.code },
        { toCurrencyCode: record.code },
      ],
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      deletedAt: null,
      isActive: true,
    })
    
    if (activeRatesCount > 0) {
      throw new CrudHttpError(400, { 
        error: `Cannot delete currency ${record.code} because it has ${activeRatesCount} active exchange rate(s). Please delete or deactivate the exchange rates first.` 
      })
    }

    record.deletedAt = new Date()
    record.isActive = false
    await em.flush()

    return { currencyId: record.id }
  },
  buildLog: async ({ snapshots, result }) => {
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
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(Currency, { id: before.id })
    if (!record) return
    record.deletedAt = null
    record.isActive = before.isActive
    record.updatedAt = new Date()
    await em.flush()
  },
}

registerCommand(createCurrencyCommand)
registerCommand(updateCurrencyCommand)
registerCommand(deleteCurrencyCommand)

export { createCurrencyCommand, updateCurrencyCommand, deleteCurrencyCommand }
