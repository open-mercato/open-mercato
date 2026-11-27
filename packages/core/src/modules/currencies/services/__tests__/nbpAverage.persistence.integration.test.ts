import { randomUUID } from 'node:crypto'
import { expect, it, jest } from '@jest/globals'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver } from '@mikro-orm/postgresql'
import { Client } from 'pg'
import { resolveIntegrationDatabaseUrl } from '@open-mercato/core/helpers/integration/dbFixtures'
import { Currency, ExchangeRate } from '../../data/entities'
import { Migration20260826143024_currencies } from '../../migrations/Migration20260826143024_currencies'
import { Migration20261125165127_currencies } from '../../migrations/Migration20261125165127_currencies'
import { NBPAverageRateProvider } from '../providers/nbpAverage'
import { RateFetchingService } from '../rateFetchingService'
import { ExchangeRateService } from '../exchangeRateService'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { ExchangeRateCreateInput, ExchangeRateUpdateInput } from '../../data/validators'
import '../../commands/exchange-rates'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

const testWithPostgres = process.env.OM_CURRENCY_PG_INTEGRATION === '1' ? it : it.skip

testWithPostgres('persists NBP publications atomically and round-trips the provenance migration', async () => {
  if (!process.env.DATABASE_URL) throw new Error('[internal] Explicit integration DATABASE_URL is required')
  const databaseUrl = resolveIntegrationDatabaseUrl()
  const schema = `currency_nbp_${randomUUID().replace(/-/g, '')}`
  const admin = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000, query_timeout: 5_000 })
  const originalFetch = globalThis.fetch
  let orm: MikroORM<PostgreSqlDriver> | null = null
  let schemaCreated = false
  let failTableB = false

  try {
    await admin.connect()
    await admin.query(`create schema "${schema}"`)
    schemaCreated = true
    orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      entities: [Currency, ExchangeRate],
      clientUrl: databaseUrl,
      schema,
    })
    await orm.schema.create()

    const firstScope = { tenantId: randomUUID(), organizationId: randomUUID() }
    const secondScope = { tenantId: firstScope.tenantId, organizationId: randomUUID() }
    const foreignScope = { tenantId: randomUUID(), organizationId: firstScope.organizationId }
    const entityManager = orm.em.fork()
    for (const scope of [firstScope, secondScope, foreignScope]) {
      for (const code of ['PLN', 'USD', 'EUR']) {
        entityManager.persist(entityManager.create(Currency, {
          ...scope,
          code,
          name: code,
          decimalPlaces: 2,
          isBase: code === 'PLN',
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        }))
      }
    }
    await entityManager.flush()

    globalThis.fetch = async (input) => {
      const url = String(input)
      const match = url.match(/^https:\/\/api\.nbp\.pl\/api\/exchangerates\/tables\/([ab])\/(\d{4}-\d{2}-\d{2})\/\?format=json$/)
      if (!match) throw new Error('[internal] Unexpected NBP fixture URL')
      const table = match[1].toUpperCase()
      if (table === 'B' && failTableB) return new Response('unavailable', { status: 503 })
      return Response.json([{
        table,
        no: `001/${table}/NBP/2024`,
        effectiveDate: match[2],
        rates: table === 'A'
          ? [{ currency: 'US dollar', code: 'USD', mid: 4.25 }]
          : [{ currency: 'Euro', code: 'EUR', mid: 5.25 }],
      }])
    }

    const service = new RateFetchingService(orm.em.fork())
    service.registerProvider(new NBPAverageRateProvider())
    const firstDate = new Date('2024-01-15T00:00:00.000Z')
    const failedDate = new Date('2024-01-16T00:00:00.000Z')
    const fetchOptions = { providers: ['nbp_average'] }
    const createCommand = commandRegistry.get<ExchangeRateCreateInput, { exchangeRateId: string }>('currencies.exchange_rates.create')
    const updateCommand = commandRegistry.get<ExchangeRateUpdateInput, { exchangeRateId: string }>('currencies.exchange_rates.update')
    if (!createCommand || !updateCommand) throw new Error('[internal] Exchange rate commands not registered')
    const activeOrm = orm
    const manualContext = {
      container: { resolve: (token: string) => token === 'em' ? activeOrm.em.fork() : { markOrmEntityChange: jest.fn() } },
      auth: { sub: randomUUID(), tenantId: firstScope.tenantId, orgId: firstScope.organizationId },
    } as unknown as CommandRuntimeContext
    const manualInput = {
      ...firstScope, fromCurrencyCode: 'USD', toCurrencyCode: 'PLN', date: firstDate,
      source: 'nbp_average', type: 'average' as const, rate: '4.25000000000000000000000000001',
    }
    const manual = await createCommand.execute(manualInput, manualContext)
    const readManual = () => activeOrm.em.fork().findOneOrFail(ExchangeRate, { id: manual.exchangeRateId, ...firstScope })
    expect(await readManual()).toMatchObject({ source: 'manual', externalReference: null, rate: manualInput.rate })
    await updateCommand.execute({ id: manual.exchangeRateId, source: 'legacy-source' }, manualContext)
    expect(await readManual()).toMatchObject({ source: 'legacy-source', rate: manualInput.rate })
    await updateCommand.execute({ id: manual.exchangeRateId, source: 'nbp_average' }, manualContext)
    expect(await readManual()).toMatchObject({ source: 'manual', externalReference: null, rate: manualInput.rate })
    expect((await new ExchangeRateService(activeOrm.em.fork(), service).getRate({
      fromCurrencyCode: 'USD', toCurrencyCode: 'PLN', date: firstDate, scope: firstScope,
      options: { provider: 'nbp_average', rateType: 'average', autoFetch: false, maxDaysBack: 0 },
    })).rates).toEqual([])
    await updateCommand.execute({ id: manual.exchangeRateId, date: new Date('2024-01-14T00:00:00.000Z') }, manualContext)

    const legacyManager = activeOrm.em.fork()
    const legacy = legacyManager.create(ExchangeRate, {
      ...manualInput, externalReference: null, isActive: true, createdAt: new Date(), updatedAt: new Date(),
    })
    legacyManager.persist(legacy)
    await legacyManager.flush()
    const officialSelection = { provider: 'nbp_average', rateType: 'average' as const, maxDaysBack: 0 }
    const selectedLookup = (autoFetch: boolean) => new ExchangeRateService(activeOrm.em.fork(), service).getRate({
      fromCurrencyCode: 'USD', toCurrencyCode: 'PLN', date: firstDate, scope: firstScope,
      options: { ...officialSelection, autoFetch },
    })
    expect((await selectedLookup(false)).rates).toEqual([])
    const fetchSpy = jest.spyOn(service, 'fetchRatesForDate')
    expect((await selectedLookup(true)).rates).toEqual([expect.objectContaining({ id: legacy.id, rate: '4.25', externalReference: '001/A/NBP/2024' })])
    expect(fetchSpy).toHaveBeenCalledWith(firstDate, firstScope, fetchOptions)
    expect(await readManual()).toMatchObject({ source: 'manual', externalReference: null, rate: manualInput.rate })

    const first = await service.fetchRatesForDate(firstDate, firstScope, fetchOptions)
    expect(first.totalFetched).toBe(2)
    expect(first.errors).toEqual([])
    const readRates = (scope: typeof firstScope, date: Date) => activeOrm.em.fork().find(ExchangeRate, { ...scope, date, source: 'nbp_average' })
    const inserted = await readRates(firstScope, firstDate)
    expect(inserted).toHaveLength(2)
    expect(inserted.map((rate) => ({ from: rate.fromCurrencyCode, to: rate.toCurrencyCode, rate: rate.rate, type: rate.type, reference: rate.externalReference })).sort((left, right) => left.from.localeCompare(right.from))).toEqual([
      { from: 'EUR', to: 'PLN', rate: '5.25', type: 'average', reference: '001/B/NBP/2024' },
      { from: 'USD', to: 'PLN', rate: '4.25', type: 'average', reference: '001/A/NBP/2024' },
    ])
    expect(await readRates(secondScope, firstDate)).toHaveLength(0)
    expect(await readRates(foreignScope, firstDate)).toHaveLength(0)

    const metadataManager = orm.em.fork()
    const annotatedRate = await metadataManager.findOneOrFail(ExchangeRate, { ...firstScope, fromCurrencyCode: 'USD', source: 'nbp_average' })
    annotatedRate.metadata = { note: 'preserve existing provider metadata' }
    await metadataManager.flush()

    const repeated = await service.fetchRatesForDate(firstDate, firstScope, fetchOptions)
    expect(repeated.totalFetched).toBe(2)
    expect(repeated.errors).toEqual([])
    const repeatedRows = await readRates(firstScope, firstDate)
    expect(repeatedRows.map((rate) => rate.id).sort()).toEqual(inserted.map((rate) => rate.id).sort())
    expect(repeatedRows.find((rate) => rate.fromCurrencyCode === 'USD')?.metadata).toEqual({ note: 'preserve existing provider metadata' })

    failTableB = true
    const failed = await service.fetchRatesForDate(failedDate, firstScope, fetchOptions)
    expect(failed.totalFetched).toBe(0)
    expect(failed.errors).toHaveLength(1)
    expect(await readRates(firstScope, failedDate)).toHaveLength(0)
    expect((await readRates(firstScope, firstDate)).map((rate) => rate.id).sort()).toEqual(inserted.map((rate) => rate.id).sort())
    failTableB = false
    const retried = await service.fetchRatesForDate(failedDate, firstScope, fetchOptions)
    expect(retried.totalFetched).toBe(2)
    expect(retried.errors).toEqual([])
    expect(await readRates(firstScope, failedDate)).toHaveLength(2)

    const second = await service.fetchRatesForDate(firstDate, secondScope, fetchOptions)
    expect(second.totalFetched).toBe(2)
    expect(await readRates(secondScope, firstDate)).toHaveLength(2)
    expect(await readRates(firstScope, firstDate)).toHaveLength(2)
    expect(await readRates(foreignScope, firstDate)).toHaveLength(0)
    const foreign = await service.fetchRatesForDate(firstDate, foreignScope, fetchOptions)
    expect(foreign.totalFetched).toBe(2)
    expect(foreign.errors).toEqual([])
    const foreignRows = await readRates(foreignScope, firstDate)
    expect(foreignRows).toHaveLength(2)
    expect(foreignRows.every((rate) => !inserted.some((original) => original.id === rate.id))).toBe(true)
    expect((await readRates(firstScope, firstDate)).map((rate) => rate.id).sort()).toEqual(inserted.map((rate) => rate.id).sort())

    const original = inserted.find((rate) => rate.fromCurrencyCode === 'USD')!
    const markOrmEntityChange = jest.fn()
    const commandContext = {
      container: { resolve: (token: string) => token === 'em' ? activeOrm.em.fork() : { markOrmEntityChange } },
      auth: { sub: randomUUID(), tenantId: firstScope.tenantId, orgId: firstScope.organizationId },
    } as unknown as CommandRuntimeContext
    const lookup = () => new ExchangeRateService(activeOrm.em.fork(), service).getRate({
      fromCurrencyCode: 'USD', toCurrencyCode: 'PLN', date: firstDate, scope: firstScope,
      options: { provider: 'nbp_average', rateType: 'average', autoFetch: false, maxDaysBack: 0 },
    })
    await updateCommand.execute({ id: original.id, rate: '4.25000', date: new Date(firstDate), source: 'nbp_average', type: 'average' }, commandContext)
    expect((await lookup()).rates[0]).toMatchObject({ source: 'nbp_average', externalReference: '001/A/NBP/2024', rate: '4.25' })
    await updateCommand.execute({ id: original.id, isActive: false }, commandContext)
    expect(await activeOrm.em.fork().findOneOrFail(ExchangeRate, { id: original.id })).toMatchObject({ source: 'nbp_average', externalReference: '001/A/NBP/2024', isActive: false })
    await updateCommand.execute({ id: original.id, isActive: true }, commandContext)
    const input = { id: original.id, rate: '4.25000000000000000000000000001' }
    const result = await updateCommand.execute(input, commandContext)
    const after = await updateCommand.captureAfter!(input, result, commandContext)
    const log = await updateCommand.buildLog!({ input, result, ctx: commandContext, snapshots: { after } })
    expect(await activeOrm.em.fork().findOneOrFail(ExchangeRate, { id: original.id })).toMatchObject({
      rate: input.rate, source: 'manual', type: 'average', externalReference: null,
      metadata: { note: 'preserve existing provider metadata' },
    })
    expect((await lookup()).rates).toEqual([])
    expect((await readRates(secondScope, firstDate)).find((rate) => rate.fromCurrencyCode === 'USD')).toMatchObject({ rate: '4.25', externalReference: '001/A/NBP/2024' })
    expect(log?.snapshotBefore).toMatchObject({ source: 'nbp_average', rate: '4.25', externalReference: '001/A/NBP/2024' })
    expect(log?.snapshotAfter).toMatchObject({ source: 'manual', rate: input.rate, externalReference: null })
    await updateCommand.undo!({ input, ctx: commandContext, logEntry: { commandPayload: log?.payload } })
    expect((await lookup()).rates[0]).toMatchObject({ id: original.id, rate: '4.25', source: 'nbp_average', type: 'average', externalReference: '001/A/NBP/2024' })
    expect(markOrmEntityChange).toHaveBeenCalledTimes(5)

    await admin.query('select set_config($1, $2, false)', ['search_path', schema])
    const retainedLineageRowsQuery = "select to_jsonb(exchange_rates) - 'undo_lineage' as record from exchange_rates order by id"
    const beforeLineageMigration = await admin.query(retainedLineageRowsQuery)
    const lineageMigration = new Migration20261125165127_currencies(orm.em.getDriver(), orm.config)
    await lineageMigration.down()
    for (const statement of lineageMigration.getQueries()) {
      if (typeof statement !== 'string') throw new Error('[internal] Unexpected migration query')
      await admin.query(statement)
    }
    expect((await admin.query(retainedLineageRowsQuery)).rows).toEqual(beforeLineageMigration.rows)
    lineageMigration.reset()
    await lineageMigration.up()
    for (const statement of lineageMigration.getQueries()) {
      if (typeof statement !== 'string') throw new Error('[internal] Unexpected migration query')
      await admin.query(statement)
    }
    expect((await admin.query('select count(*)::text as count from exchange_rates where undo_lineage is not null')).rows).toEqual([{ count: '0' }])
    expect((await admin.query(retainedLineageRowsQuery)).rows).toEqual(beforeLineageMigration.rows)

    const retainedRowsQuery = "select to_jsonb(exchange_rates) - 'external_reference' as record from exchange_rates order by id"
    const beforeMigration = await admin.query(retainedRowsQuery)
    const migration = new Migration20260826143024_currencies(orm.em.getDriver(), orm.config)
    await migration.down()
    for (const statement of migration.getQueries()) {
      if (typeof statement !== 'string') throw new Error('[internal] Unexpected migration query')
      await admin.query(statement)
    }
    expect((await admin.query(retainedRowsQuery)).rows).toEqual(beforeMigration.rows)
    const removedColumn = await admin.query<{ count: string }>(
      'select count(*)::text as count from information_schema.columns where table_schema = $1 and table_name = $2 and column_name = $3',
      [schema, 'exchange_rates', 'external_reference'],
    )
    expect(removedColumn.rows[0].count).toBe('0')
    migration.reset()
    await migration.up()
    for (const statement of migration.getQueries()) {
      if (typeof statement !== 'string') throw new Error('[internal] Unexpected migration query')
      await admin.query(statement)
    }
    const restored = await admin.query<{ count: string; without_reference: string }>(
      'select count(*)::text as count, count(*) filter (where external_reference is null)::text as without_reference from exchange_rates',
    )
    expect(restored.rows[0]).toEqual({ count: '9', without_reference: '9' })
    expect((await admin.query(retainedRowsQuery)).rows).toEqual(beforeMigration.rows)
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
})
