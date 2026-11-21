import { randomUUID } from 'node:crypto'
import { asValue, createContainer } from 'awilix'
import { MikroORM } from '@mikro-orm/core'
import { EntityManager, PostgreSqlDriver } from '@mikro-orm/postgresql'
import { Client } from 'pg'
import { CommandBus, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'
import { Currency, ExchangeRate } from '../../data/entities'
import { RateFetchingService } from '../../services/rateFetchingService'
import { NBPAverageRateProvider } from '../../services/providers/nbpAverage'
import { ExchangeRateService } from '../../services/exchangeRateService'
import { updateExchangeRateCommand } from '../exchange-rates'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

const testWithPostgres = process.env.OM_CURRENCY_PG_INTEGRATION === '1' ? it : it.skip

testWithPostgres.each(['fetch', 'official lookup'] as const)('refuses occupied-key undo after %s and releases its real action-log claim', async (refetchPath) => {
  await withPostgres(async ({ orm, fetchRates, scope, date, context, bus, edit, rows, logs, sideEffects, queries }) => {
    const original = (await rows(scope))[0]
    const { token, logId } = await edit(original.id)
    if (refetchPath === 'fetch') {
      await fetchRates.fetchRatesForDate(date, scope, { providers: ['nbp_average'] })
    } else {
      const lookup = await new ExchangeRateService(orm.em.fork(), fetchRates).getRate({
        fromCurrencyCode: 'USD', toCurrencyCode: 'PLN', date, scope,
        options: { provider: 'nbp_average', rateType: 'average', autoFetch: true, maxDaysBack: 0 },
      })
      expect(lookup.rates).toEqual([expect.objectContaining({ source: 'nbp_average', rate: '4.25', externalReference: '011/A/NBP/2024' })])
      expect(lookup.rates[0].id).not.toBe(original.id)
    }
    const beforeUndo = await rows(scope)
    expect(beforeUndo).toHaveLength(2)
    expect(beforeUndo).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: original.id, source: 'manual', rate: '8.125', externalReference: null }),
      expect.objectContaining({ source: 'nbp_average', rate: '4.25', externalReference: '011/A/NBP/2024', metadata: null }),
    ]))
    const effectsBeforeUndo = sideEffects.mock.calls.length
    for (let attempt = 0; attempt < 2; attempt++) {
      const queryStart = queries.length
      await expect(bus.undo(token, context())).rejects.toMatchObject({ status: 409 })
      expect(queries.slice(queryStart).some((query) => /update .*"exchange_rates" set/.test(query))).toBe(false)
      expect(await rows(scope)).toEqual(beforeUndo)
      expect(await logs()).toEqual([expect.objectContaining({ id: logId, executionState: 'done', undoToken: token })])
      expect(sideEffects).toHaveBeenCalledTimes(effectsBeforeUndo)
    }
  })
})

testWithPostgres('restores an unoccupied original identity with scoped foreign publications and consumes undo only once', async () => {
  await withPostgres(async ({ orm, fetchRates, scope, date, context, bus, edit, rows, logs, sideEffects, queries }) => {
    const original = (await rows(scope))[0]
    const { token, logId } = await edit(original.id)
    const foreignScopes = [
      { ...scope, organizationId: randomUUID() },
      { ...scope, tenantId: randomUUID() },
    ]
    for (const foreignScope of foreignScopes) {
      const manager = orm.em.fork()
      manager.persist(manager.create(ExchangeRate, {
        ...foreignScope, fromCurrencyCode: 'USD', toCurrencyCode: 'PLN', rate: '6.25', date,
        source: 'nbp_average', type: 'average', externalReference: '012/A/NBP/2024',
        metadata: { foreign: true }, isActive: true, createdAt: date, updatedAt: date,
      }))
      await manager.flush()
    }
    const foreignBefore = await Promise.all(foreignScopes.map(rows))
    const effectsBeforeUndo = sideEffects.mock.calls.length
    const queryStart = queries.length
    await bus.undo(token, context())
    expect(queries.slice(queryStart).some((query) => /update .*"exchange_rates" set/.test(query))).toBe(true)
    expect(await rows(scope)).toEqual([expect.objectContaining({
      id: original.id, rate: original.rate, date, source: original.source,
      type: original.type, externalReference: original.externalReference, metadata: original.metadata, isActive: true,
    })])
    expect(await Promise.all(foreignScopes.map(rows))).toEqual(foreignBefore)
    expect(sideEffects).toHaveBeenCalledTimes(effectsBeforeUndo + 1)
    expect(await logs()).toEqual([
      expect.objectContaining({ id: logId, executionState: 'undone', undoToken: null }),
      expect.objectContaining({ contextJson: expect.objectContaining({ historyAction: 'undo', sourceLogId: logId }) }),
    ])
    const restored = await rows(scope)
    await expect(bus.undo(token, context())).rejects.toThrow('Undo token expired or not found')
    expect(await rows(scope)).toEqual(restored)
    expect(sideEffects).toHaveBeenCalledTimes(effectsBeforeUndo + 1)
    expect((await new ExchangeRateService(orm.em.fork(), fetchRates).getRate({
      fromCurrencyCode: 'USD', toCurrencyCode: 'PLN', date, scope,
      options: { provider: 'nbp_average', rateType: 'average', autoFetch: false, maxDaysBack: 0 },
    })).rates[0].id).toBe(original.id)
  })
})

testWithPostgres.each(['rate', 'metadata', 'deletedAt'] as const)('preserves intervening %s changes even when the original key is free', async (field) => {
  await withPostgres(async ({ orm, scope, context, bus, edit, rows, logs, sideEffects, queries }) => {
    const original = (await rows(scope))[0]
    const { token, logId } = await edit(original.id)
    const manager = orm.em.fork()
    const current = await manager.findOneOrFail(ExchangeRate, { ...scope, id: original.id })
    if (field === 'rate') current.rate = '9.75'
    if (field === 'metadata') current.metadata = { intervening: true }
    if (field === 'deletedAt') current.deletedAt = new Date()
    await manager.flush()
    const beforeUndo = await rows(scope)
    const effectsBeforeUndo = sideEffects.mock.calls.length
    const queryStart = queries.length
    await expect(bus.undo(token, context())).rejects.toMatchObject({ status: 409 })
    expect(queries.slice(queryStart).some((query) => /update .*"exchange_rates" set/.test(query))).toBe(false)
    expect(await rows(scope)).toEqual(beforeUndo)
    expect(await logs()).toEqual([expect.objectContaining({ id: logId, executionState: 'done', undoToken: token })])
    expect(sideEffects).toHaveBeenCalledTimes(effectsBeforeUndo)
  })
})

testWithPostgres.each(['organizationId', 'tenantId'] as const)('cannot undo a record outside the caller %s', async (field) => {
  await withPostgres(async ({ scope, context, bus, edit, rows, sideEffects }) => {
    const original = (await rows(scope))[0]
    const { token } = await edit(original.id)
    const beforeUndo = await rows(scope)
    const effectsBeforeUndo = sideEffects.mock.calls.length
    await bus.undo(token, context({ ...scope, [field]: randomUUID() }))
    expect(await rows(scope)).toEqual(beforeUndo)
    expect(sideEffects).toHaveBeenCalledTimes(effectsBeforeUndo)
  })
})

testWithPostgres('preserves both rows when a publication is inserted after undo preflight', async () => {
  await withPostgres(async ({ scope, date, fetchRates, context, bus, edit, rows, logs, sideEffects }) => {
    const original = (await rows(scope))[0]
    const { token, logId } = await edit(original.id)
    const manual = (await rows(scope))[0]
    const effectsBeforeUndo = sideEffects.mock.calls.length
    const originalFlush = EntityManager.prototype.flush
    let pendingFetch = true
    const flushSpy = jest.spyOn(EntityManager.prototype, 'flush').mockImplementation(async function (this: EntityManager) {
      if (pendingFetch && this.isInTransaction()) {
        pendingFetch = false
        const fetched = await fetchRates.fetchRatesForDate(date, scope, { providers: ['nbp_average'] })
        expect(fetched.errors).toEqual([])
        expect(fetched.totalFetched).toBe(1)
      }
      await originalFlush.call(this)
    })
    try {
      await expect(bus.undo(token, context())).rejects.toMatchObject({ status: 409 })
    } finally {
      flushSpy.mockRestore()
    }
    expect(pendingFetch).toBe(false)
    expect(await rows(scope)).toEqual(expect.arrayContaining([
      manual,
      expect.objectContaining({ source: 'nbp_average', rate: '4.25', externalReference: '011/A/NBP/2024' }),
    ]))
    expect(await rows(scope)).toHaveLength(2)
    expect(await logs()).toEqual([expect.objectContaining({ id: logId, executionState: 'done', undoToken: token })])
    expect(sideEffects).toHaveBeenCalledTimes(effectsBeforeUndo)
  })
})

testWithPostgres('rolls back an already flushed undo if its transaction fails and permits retry', async () => {
  await withPostgres(async ({ scope, context, bus, edit, rows, logs, sideEffects }) => {
    const original = (await rows(scope))[0]
    const { token, logId } = await edit(original.id)
    const beforeUndo = await rows(scope)
    const effectsBeforeUndo = sideEffects.mock.calls.length
    const originalFlush = EntityManager.prototype.flush
    const flushSpy = jest.spyOn(EntityManager.prototype, 'flush').mockImplementationOnce(async function (this: EntityManager) {
      await originalFlush.call(this)
      throw new Error('[internal] Injected failure after SQL update')
    })
    try {
      await expect(bus.undo(token, context())).rejects.toThrow('[internal] Injected failure after SQL update')
    } finally {
      flushSpy.mockRestore()
    }
    expect(await rows(scope)).toEqual(beforeUndo)
    expect(await logs()).toEqual([expect.objectContaining({ id: logId, executionState: 'done', undoToken: token })])
    expect(sideEffects).toHaveBeenCalledTimes(effectsBeforeUndo)
    await bus.undo(token, context())
    expect(await rows(scope)).toEqual([expect.objectContaining({ id: original.id, rate: '4.25', source: 'nbp_average', externalReference: original.externalReference })])
  })
})

testWithPostgres('treats soft-deleted and inactive replacement keys as occupied', async () => {
  await withPostgres(async ({ orm, scope, date, fetchRates, context, bus, edit, rows }) => {
    const original = (await rows(scope))[0]
    const { token } = await edit(original.id)
    await fetchRates.fetchRatesForDate(date, scope, { providers: ['nbp_average'] })
    await orm.em.fork().nativeUpdate(ExchangeRate, { ...scope, source: 'nbp_average' }, { deletedAt: new Date(), isActive: false })
    const beforeUndo = await rows(scope)
    await expect(bus.undo(token, context())).rejects.toMatchObject({ status: 409 })
    expect(await rows(scope)).toEqual(beforeUndo)
  })
})

type Scope = { tenantId: string; organizationId: string }

async function withPostgres(run: (fixture: {
  orm: MikroORM<PostgreSqlDriver>
  fetchRates: RateFetchingService
  scope: Scope
  date: Date
  context: (scope?: Scope) => CommandRuntimeContext
  bus: CommandBus
  edit: (id: string) => Promise<{ token: string; logId: string }>
  rows: (scope: Scope) => Promise<ExchangeRate[]>
  logs: () => Promise<ActionLog[]>
  sideEffects: jest.Mock
  queries: string[]
}) => Promise<void>) {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('[internal] Explicit disposable DATABASE_URL is required')
  const schema = `currency_undo_${randomUUID().replace(/-/g, '')}`
  const admin = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000, query_timeout: 5_000 })
  let orm: MikroORM<PostgreSqlDriver> | undefined
  const originalFetch = globalThis.fetch
  let schemaCreated = false
  try {
    await admin.connect()
    await admin.query(`create schema "${schema}"`)
    schemaCreated = true
    const queries: string[] = []
    orm = await MikroORM.init({ driver: PostgreSqlDriver, entities: [Currency, ExchangeRate, ActionLog], clientUrl: databaseUrl, schema, debug: ['query'], logger: (message) => queries.push(message.replace(/\u001b\[[0-9;]*m/g, '')) })
    await orm.schema.create()
    const activeOrm = orm
    const scope: Scope = { tenantId: randomUUID(), organizationId: randomUUID() }
    const date = new Date('2024-01-15T00:00:00.000Z')
    const manager = orm.em.fork()
    for (const code of ['USD', 'PLN']) {
      manager.persist(manager.create(Currency, { ...scope, code, name: code, decimalPlaces: 2, isBase: code === 'PLN', isActive: true, createdAt: date, updatedAt: date }))
    }
    await manager.flush()
    globalThis.fetch = async (input) => {
      const url = String(input)
      if (url.includes('/tables/b/')) return new Response('', { status: 404 })
      if (!url.includes('/tables/a/2024-01-15/')) throw new Error('[internal] Unexpected fixture URL')
      return Response.json([{ table: 'A', no: '011/A/NBP/2024', effectiveDate: '2024-01-15', rates: [{ currency: 'US dollar', code: 'USD', mid: 4.25 }] }])
    }
    const fetchRates = new RateFetchingService(orm.em.fork())
    fetchRates.registerProvider(new NBPAverageRateProvider())
    expect((await fetchRates.fetchRatesForDate(date, scope, { providers: ['nbp_average'] })).errors).toEqual([])
    const sideEffects = jest.fn()
    const context = (selectedScope: Scope = scope): CommandRuntimeContext => {
      const container = createContainer()
      container.register({
        em: asValue(activeOrm.em.fork()),
        actionLogService: asValue(new ActionLogService(activeOrm.em.fork())),
        dataEngine: asValue({ markOrmEntityChange: sideEffects, flushOrmEntityChanges: jest.fn() }),
      })
      return { container, auth: { sub: randomUUID(), tenantId: selectedScope.tenantId, orgId: selectedScope.organizationId }, selectedOrganizationId: selectedScope.organizationId, organizationScope: null, organizationIds: null }
    }
    const bus = new CommandBus()
    const edit = async (id: string) => {
      const ctx = context()
      const input = { id, rate: '8.125' }
      const { logEntry } = await bus.execute(updateExchangeRateCommand.id, { input, ctx })
      if (!logEntry?.undoToken) throw new Error('[internal] Missing action log undo token')
      expect(logEntry.snapshotBefore).toMatchObject({ source: 'nbp_average', rate: '4.25', externalReference: '011/A/NBP/2024' })
      expect(logEntry.snapshotAfter).toMatchObject({ source: 'manual', rate: '8.125', externalReference: null })
      return { token: logEntry.undoToken, logId: logEntry.id }
    }
    const rows = (selectedScope: Scope) => activeOrm.em.fork().find(ExchangeRate, selectedScope, { orderBy: { id: 'asc' } })
    const logs = () => activeOrm.em.fork().find(ActionLog, {}, { orderBy: { createdAt: 'asc' } })
    await run({ orm, fetchRates, scope, date, context, bus, edit, rows, logs, sideEffects, queries })
  } finally {
    globalThis.fetch = originalFetch
    try {
      await orm?.close(true)
    } finally {
      try {
        if (schemaCreated) await admin.query(`drop schema "${schema}" cascade`)
      } finally {
        await admin.end()
      }
    }
  }
}
