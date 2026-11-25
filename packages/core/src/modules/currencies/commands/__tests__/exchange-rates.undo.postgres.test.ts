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
import { deleteExchangeRateCommand, updateExchangeRateCommand } from '../exchange-rates'

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

testWithPostgres.each([false, true])('checks sequential undo with an intervening timestamp-only write: %s', async (interveningWrite) => {
  await withPostgres(async ({ orm, scope, date, context, bus, logs, sideEffects }) => {
    const manager = orm.em.fork()
    const original = manager.create(ExchangeRate, {
      ...scope, fromCurrencyCode: 'USD', toCurrencyCode: 'PLN', rate: '4.25', date,
      source: 'manual', createdAt: date, updatedAt: date,
    })
    manager.persist(original)
    await manager.flush()
    const scopedRate = { ...scope, id: original.id }
    const first = await bus.execute(updateExchangeRateCommand.id, { input: { id: original.id, rate: '5.25' }, ctx: context() })
    const second = await bus.execute(updateExchangeRateCommand.id, { input: { id: original.id, rate: '6.25' }, ctx: context() })
    const token = first.logEntry?.undoToken
    expect(typeof token).toBe('string')
    await bus.undo(second.logEntry.undoToken, context())
    const firstRestored = await orm.em.fork().findOneOrFail(ExchangeRate, scopedRate)
    expect(firstRestored.rate).toBe('5.25')
    expect(firstRestored.updatedAt.toISOString() > second.logEntry.snapshotAfter.updatedAt).toBe(true)
    expect(firstRestored.undoLineage).toEqual({
      restoredUpdatedAt: first.logEntry.snapshotAfter.updatedAt,
      writtenUpdatedAt: firstRestored.updatedAt.toISOString(),
    })

    if (interveningWrite) {
      const newerVersion = new Date(firstRestored.updatedAt.getTime() + 1)
      await orm.em.fork().nativeUpdate(ExchangeRate, scopedRate, { updatedAt: newerVersion })
      const effectsBeforeUndo = sideEffects.mock.calls.length
      await expect(bus.undo(token, context())).rejects.toMatchObject({ status: 409 })
      expect(sideEffects).toHaveBeenCalledTimes(effectsBeforeUndo)
      expect(await orm.em.fork().findOneOrFail(ExchangeRate, scopedRate)).toMatchObject({ rate: '5.25', updatedAt: newerVersion })
      expect(await logs()).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: first.logEntry.id, executionState: 'done', undoToken: token }),
        expect.objectContaining({ id: second.logEntry.id, executionState: 'undone', undoToken: null }),
      ]))
      return
    }

    const service = new ActionLogService(orm.em.fork())
    expect(await service.latestUndoableForResource({ ...scope, actorUserId: context().auth!.sub, resourceKind: 'currencies.exchange_rate', resourceId: original.id })).toMatchObject({ undoToken: token })
    await bus.undo(token, context())
    const restored = await orm.em.fork().findOneOrFail(ExchangeRate, scopedRate)
    expect(restored.rate).toBe(original.rate)
    expect(restored.updatedAt.getTime()).toBeGreaterThan(firstRestored.updatedAt.getTime())
    expect(await logs()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.logEntry.id, executionState: 'undone', undoToken: null }),
      expect.objectContaining({ id: second.logEntry.id, executionState: 'undone', undoToken: null }),
    ]))
  })
})

testWithPostgres('carries the restored version through editing and undoing a previously restored rate', async () => {
  await withPostgres(async ({ context, bus, edit, scope, rows }) => {
    const original = (await rows(scope))[0]
    const first = await edit(original.id)
    const write = async (rate: string) => bus.execute(updateExchangeRateCommand.id, { input: { id: original.id, rate }, ctx: context() })
    const second = await write('9.25')
    await bus.undo(second.logEntry.undoToken, context())
    const third = await write('10.25')
    const fourth = await write('11.25')
    await bus.undo(fourth.logEntry.undoToken, context())
    await bus.undo(third.logEntry.undoToken, context())
    await bus.undo(first.token, context())
    expect(await rows(scope)).toEqual([expect.objectContaining({ id: original.id, rate: original.rate, externalReference: original.externalReference })])
  })
})

testWithPostgres('uses the provider-refreshed predecessor when another write happens before the update lock', async () => {
  await withPostgres(async ({ bus, context, date, fetchRates, scope, rows }) => {
    const original = (await rows(scope))[0]
    const write = (metadata: Record<string, unknown>, ctx = context()) => bus.execute(updateExchangeRateCommand.id, { input: { id: original.id, metadata }, ctx })
    const first = await write({ note: 'first' })
    const second = await write({ note: 'second' })
    await bus.undo(second.logEntry.undoToken, context())
    const restored = (await rows(scope))[0]
    expect(restored.undoLineage?.restoredUpdatedAt).toBe(first.logEntry.snapshotAfter.updatedAt)

    const third = await write({ note: 'third' }, {
      ...context(), beforeTransactionalWrite: async () => {
        const result = await fetchRates.fetchRatesForDate(date, scope, { providers: ['nbp_average'] })
        expect(result.errors).toEqual([])
      },
    })
    expect(third.logEntry.snapshotBefore.updatedAt > restored.updatedAt.toISOString()).toBe(true)
    await bus.undo(third.logEntry.undoToken, context())
    const after = (await rows(scope))[0]
    expect(after.metadata).toEqual({ note: 'first' })
    expect(after.undoLineage?.restoredUpdatedAt).toBe(third.logEntry.snapshotBefore.updatedAt)
    await expect(bus.undo(first.logEntry.undoToken, context())).rejects.toMatchObject({ status: 409 })
  })
})

testWithPostgres('keeps the committed after-version if a later write lands before audit capture', async () => {
  await withPostgres(async ({ orm, bus, context, scope, rows }) => {
    const original = (await rows(scope))[0]
    const captureAfter = updateExchangeRateCommand.captureAfter!
    const capture = jest.spyOn(updateExchangeRateCommand, 'captureAfter').mockImplementationOnce(async (input, result, ctx) => {
      const manager = orm.em.fork()
      const where = { ...scope, id: original.id }
      const committed = await manager.findOneOrFail(ExchangeRate, where)
      await manager.nativeUpdate(ExchangeRate, where, { updatedAt: new Date(committed.updatedAt.getTime() + 1) })
      return captureAfter(input, result, ctx)
    })
    try {
      const write = await bus.execute(updateExchangeRateCommand.id, { input: { id: original.id, rate: '9.25' }, ctx: context() })
      expect(write.logEntry.snapshotAfter.updatedAt < (await rows(scope))[0].updatedAt.toISOString()).toBe(true)
      await expect(bus.undo(write.logEntry.undoToken, context())).rejects.toMatchObject({ status: 409 })
    } finally {
      capture.mockRestore()
    }
  })
})

testWithPostgres('clears the undo marker on redo and records the restored predecessor', async () => {
  await withPostgres(async ({ orm, bus, context, edit, scope, rows }) => {
    const original = (await rows(scope))[0]
    const first = await edit(original.id)
    const input = { id: original.id, rate: '9.25' }
    const second = await bus.execute(updateExchangeRateCommand.id, { input, ctx: context() })
    await bus.undo(second.logEntry.undoToken, context())
    expect((await rows(scope))[0].undoLineage).toBeDefined()
    const source = await new ActionLogService(orm.em.fork()).findById(second.logEntry.id)
    if (!source) throw new Error('[internal] Missing redo source')
    const redo = await bus.execute(updateExchangeRateCommand.id, { input, ctx: context(), redoLogEntry: source })
    expect(redo.replaySourceFinalized).toBe(true)
    expect((await rows(scope))[0]).toMatchObject({ rate: '9.25', undoLineage: null })
    await bus.undo(redo.logEntry.undoToken, context())
    await bus.undo(first.token, context())
    expect((await rows(scope))[0]).toMatchObject({ rate: original.rate, externalReference: original.externalReference })
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

testWithPostgres('rolls back a restored rate and its lineage when action-log finalization fails', async () => {
  await withPostgres(async ({ scope, context, bus, edit, rows, logs, sideEffects }) => {
    const original = (await rows(scope))[0]
    const { token, logId } = await edit(original.id)
    const beforeUndo = await rows(scope)
    const effectsBeforeUndo = sideEffects.mock.calls.length
    const markUndone = ActionLogService.prototype.markUndone
    const failure = jest.spyOn(ActionLogService.prototype, 'markUndone').mockImplementationOnce(async function (this: ActionLogService, ...args) {
      await markUndone.apply(this, args)
      throw new Error('[internal] Injected action-log failure')
    })
    try {
      await expect(bus.undo(token, context())).rejects.toThrow('[internal] Injected action-log failure')
    } finally {
      failure.mockRestore()
    }
    expect(await rows(scope)).toEqual(beforeUndo)
    expect(await logs()).toEqual([expect.objectContaining({ id: logId, executionState: 'done', undoToken: token })])
    expect(sideEffects).toHaveBeenCalledTimes(effectsBeforeUndo)
    await bus.undo(token, context())
    expect(await rows(scope)).toEqual([expect.objectContaining({ id: original.id, rate: original.rate })])
    expect(sideEffects).toHaveBeenCalledTimes(effectsBeforeUndo + 1)
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

testWithPostgres.each([false, true])('checks edit undo after restoring a deletion with an intervening write: %s', async (interveningWrite) => {
  await withPostgres(async ({ orm, scope, context, bus, edit, rows }) => {
    const original = (await rows(scope))[0]
    const { token } = await edit(original.id)
    const deletion = await bus.execute(deleteExchangeRateCommand.id, { input: { ...scope, id: original.id }, ctx: context() })
    if (interveningWrite) {
      const deleted = (await rows(scope))[0]
      await orm.em.fork().nativeUpdate(ExchangeRate, { ...scope, id: original.id }, {
        updatedAt: new Date(deleted.updatedAt.getTime() + 1),
      })
      await expect(bus.undo(deletion.logEntry.undoToken, context())).rejects.toMatchObject({ status: 409 })
      expect((await rows(scope))[0].deletedAt).toBeInstanceOf(Date)
      return
    }

    await bus.undo(deletion.logEntry.undoToken, context())
    await bus.undo(token, context())
    expect((await rows(scope))[0]).toMatchObject({
      rate: original.rate,
      source: original.source,
      externalReference: original.externalReference,
      isActive: true,
      deletedAt: null,
    })
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
    const actorId = randomUUID()
    const context = (selectedScope: Scope = scope): CommandRuntimeContext => {
      const container = createContainer()
      container.register({
        em: asValue(activeOrm.em.fork()),
        actionLogService: asValue(new ActionLogService(activeOrm.em.fork())),
        dataEngine: asValue({ markOrmEntityChange: sideEffects, flushOrmEntityChanges: jest.fn() }),
      })
      return { container, auth: { sub: actorId, tenantId: selectedScope.tenantId, orgId: selectedScope.organizationId }, selectedOrganizationId: selectedScope.organizationId, organizationScope: null, organizationIds: null }
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
