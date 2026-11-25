/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/core'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { Currency, ExchangeRate } from '../../data/entities'
import type { ExchangeRateCreateInput, ExchangeRateUpdateInput } from '../../data/validators'
import { ExchangeRateService } from '../../services/exchangeRateService'
import { RateFetchingService } from '../../services/rateFetchingService'
import { NBPAverageRateProvider } from '../../services/providers/nbpAverage'

const registerCommand = jest.fn()
jest.mock('@open-mercato/shared/lib/commands', () => ({ registerCommand }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const recordId = '33333333-3333-4333-8333-333333333333'
const date = new Date('2024-01-15T00:00:00.000Z')
type UpdateCommand = CommandHandler<ExchangeRateUpdateInput, { exchangeRateId: string }>
type CreateCommand = CommandHandler<ExchangeRateCreateInput, { exchangeRateId: string }>

function matches(record: ExchangeRate, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    const stored = Reflect.get(record, key)
    if (value instanceof Date) return stored instanceof Date && stored.getTime() === value.getTime()
    if (value && typeof value === 'object' && '$ne' in value) return stored !== value.$ne
    if (value && typeof value === 'object' && '$nin' in value && Array.isArray(value.$nin)) return !value.$nin.includes(stored)
    return (stored ?? null) === value
  })
}

function setup(overrides: Partial<ExchangeRate> = {}, duplicates: ExchangeRate[] = []) {
  const record = Object.assign(new ExchangeRate(), {
    ...scope, id: recordId, fromCurrencyCode: 'USD', toCurrencyCode: 'PLN',
    rate: '4.12345678901234567890123456789', date, source: 'nbp_average', type: 'average',
    externalReference: '011/A/NBP/2024', metadata: { note: 'retained' }, isActive: true, deletedAt: null,
    createdAt: date, updatedAt: date, ...overrides,
  })
  const records = [record, ...duplicates]
  const flush = jest.fn().mockResolvedValue(undefined)
  const em = {
    fork: jest.fn(), flush,
    transactional: jest.fn(async (work: (manager: unknown) => Promise<unknown>): Promise<unknown> => work(em)),
    create: jest.fn((_entity: unknown, data: Partial<ExchangeRate>) => Object.assign(new ExchangeRate(), { id: '66666666-6666-4666-8666-666666666666', deletedAt: null }, data)),
    persist: jest.fn((created: ExchangeRate) => records.push(created)),
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) =>
      entity === Currency ? { code: where.code } : records.find((item) => matches(item, where)) ?? null),
    find: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => records.filter((item) => matches(item, where))),
    nativeUpdate: jest.fn(async (_entity: unknown, where: Record<string, unknown>, update: Partial<ExchangeRate>) => {
      const matching = records.filter((item) => matches(item, where))
      matching.forEach((item) => Object.assign(item, update))
      return matching.length
    }),
  }
  em.fork.mockReturnValue(em)
  const markOrmEntityChange = jest.fn()
  const ctx = {
    container: { resolve: (token: string) => token === 'em' ? em : { markOrmEntityChange } },
    auth: { sub: 'operator', tenantId: scope.tenantId, orgId: scope.organizationId },
  } as unknown as CommandRuntimeContext
  const fetching = new RateFetchingService(em as unknown as EntityManager)
  fetching.registerProvider(new NBPAverageRateProvider())
  const service = new ExchangeRateService(em as unknown as EntityManager, fetching)
  const officialLookup = () => service.getRate({
    fromCurrencyCode: 'USD', toCurrencyCode: 'PLN', date, scope,
    options: { provider: 'nbp_average', rateType: 'average', autoFetch: false, maxDaysBack: 0 },
  })
  return { record, records, em, ctx, markOrmEntityChange, officialLookup }
}

let command: UpdateCommand
let createCommand: CreateCommand
beforeAll(() => {
  require('../exchange-rates')
  command = registerCommand.mock.calls.find(([handler]) => handler.id === 'currencies.exchange_rates.update')?.[0] as UpdateCommand
  expect(command).toBeDefined()
  createCommand = registerCommand.mock.calls.find(([handler]) => handler.id === 'currencies.exchange_rates.create')?.[0] as CreateCommand
  expect(createCommand).toBeDefined()
})

it('normalizes manual create with the provider source before duplicate checks and audit capture', async () => {
  const { records, em, ctx, markOrmEntityChange, officialLookup } = setup()
  const official = records.pop()!
  const input = { ...scope, fromCurrencyCode: 'USD', toCurrencyCode: 'PLN', date, source: ' nbp_average ', type: 'average' as const, rate: '4.12345678901234567890123456788', externalReference: 'forged/A/NBP/2024' }
  const result = await createCommand.execute(input, ctx)
  const created = records.find((row) => row.source === 'manual')!
  expect(created).toMatchObject({ rate: input.rate, source: 'manual', type: 'average', externalReference: null })
  expect(em.findOne).toHaveBeenCalledWith(ExchangeRate, expect.objectContaining({ ...scope, source: 'manual' }))
  expect((await officialLookup()).rates).toEqual([])
  expect(em.flush).toHaveBeenCalledTimes(1)
  expect(markOrmEntityChange).toHaveBeenCalledTimes(1)
  const after = await createCommand.captureAfter!(input, result, ctx)
  const log = await createCommand.buildLog!({ input, result, ctx, snapshots: { after } })
  expect(log?.snapshotAfter).toMatchObject({ source: 'manual', externalReference: null, rate: input.rate })
  records.push(official)
  expect((await officialLookup()).rates).toEqual([official])
})

it('checks the normalized manual create key and emits nothing on conflict', async () => {
  const { ctx, em, markOrmEntityChange } = setup({ source: 'manual', externalReference: null })
  await expect(createCommand.execute({ ...scope, fromCurrencyCode: 'USD', toCurrencyCode: 'PLN', date, source: 'nbp_average', type: 'average', rate: '9' }, ctx)).rejects.toMatchObject({ status: 409 })
  expect(em.persist).not.toHaveBeenCalled()
  expect(em.flush).not.toHaveBeenCalled()
  expect(markOrmEntityChange).not.toHaveBeenCalled()
})

it.each(['manual', 'NBP', 'Raiffeisen Bank Polska', 'custom-provider'])('retains manual create source %s', async (source) => {
  const { records, ctx } = setup()
  records.length = 0
  await createCommand.execute({ ...scope, fromCurrencyCode: 'USD', toCurrencyCode: 'PLN', date, source, rate: '4.12345678901234567890123456789' }, ctx)
  expect(records[0]).toMatchObject({ source, externalReference: null, rate: '4.12345678901234567890123456789' })
})

it.each(['manual', 'NBP', 'custom-provider'])('normalizes a source-changing update from %s without changing its amount', async (source) => {
  const { record, ctx, officialLookup } = setup({ source, externalReference: null })
  await command.execute({ id: recordId, source: ' nbp_average ', type: 'average' }, ctx)
  expect(record).toMatchObject({ source: 'manual', rate: '4.12345678901234567890123456789', externalReference: null })
  expect((await officialLookup()).rates).toEqual([])
})

it('checks the normalized manual key before a source-changing update', async () => {
  const duplicate = setup({ id: '44444444-4444-4444-8444-444444444444', source: 'manual', externalReference: null }).record
  const { record, ctx, em, markOrmEntityChange } = setup({ source: 'custom-provider', externalReference: null }, [duplicate])
  await expect(command.execute({ id: recordId, source: 'nbp_average' }, ctx)).rejects.toMatchObject({ status: 409 })
  expect(record.source).toBe('custom-provider')
  expect(em.flush).not.toHaveBeenCalled()
  expect(markOrmEntityChange).not.toHaveBeenCalled()
})

it.each(['NBP', 'custom-provider'])('retains a source-changing update to legacy source %s', async (source) => {
  const { record, ctx } = setup({ source: 'manual', externalReference: null })
  await command.execute({ id: recordId, source }, ctx)
  expect(record).toMatchObject({ source, externalReference: null })
})

const factChanges: Array<[string, Partial<ExchangeRateUpdateInput>]> = [
  ['exact rate', { rate: '4.12345678901234567890123456788' }],
  ['from currency', { fromCurrencyCode: 'EUR' }],
  ['to currency', { toCurrencyCode: 'EUR' }],
  ['date', { date: new Date('2024-01-16T00:00:00.000Z') }],
  ['time within the publication day', { date: new Date('2024-01-15T01:00:00.000Z') }],
  ['source', { source: 'NBP' }],
  ['type', { type: 'buy' }],
  ['null type', { type: null }],
]

it.each(factChanges)('detaches changed %s, excludes it from official lookup, and restores facts on undo', async (_label, change) => {
  const { record, em, ctx, markOrmEntityChange, officialLookup } = setup()
  const input = { id: recordId, ...change }
  expect((await officialLookup()).rates).toEqual([record])

  const result = await command.execute(input, ctx)
  expect((await officialLookup()).rates).toEqual([])
  expect(record).toMatchObject({ ...change, source: 'manual' })
  expect(record.source).toBe('manual')
  expect(record.externalReference).toBeNull()
  expect(record.metadata).toEqual({ note: 'retained' })
  expect(markOrmEntityChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'updated', entity: record, identifiers: { ...scope, id: recordId } }))
  expect(em.flush.mock.invocationCallOrder[0]).toBeLessThan(markOrmEntityChange.mock.invocationCallOrder[0])

  const after = await command.captureAfter!(input, result, ctx)
  const log = await command.buildLog!({ input, result, ctx, snapshots: { after } })
  expect(log?.snapshotAfter).toMatchObject({ source: 'manual', externalReference: null })
  expect(log?.snapshotBefore).toMatchObject({ rate: '4.12345678901234567890123456789', source: 'nbp_average', externalReference: '011/A/NBP/2024' })
  await command.undo!({ input, ctx, logEntry: { commandPayload: log?.payload } })

  expect(record).toMatchObject({ fromCurrencyCode: 'USD', toCurrencyCode: 'PLN', rate: '4.12345678901234567890123456789', date, source: 'nbp_average', type: 'average', externalReference: '011/A/NBP/2024', metadata: { note: 'retained' }, isActive: true })
  expect((await officialLookup()).rates).toEqual([record])
  expect(markOrmEntityChange).toHaveBeenCalledTimes(2)
})

it.each([
  ['activation', { isActive: false }],
  ['metadata', { metadata: { note: 'edited' } }],
  ['same normalized facts', { fromCurrencyCode: ' usd ', toCurrencyCode: 'pln', rate: '4.123456789012345678901234567890', date: new Date('2024-01-15T00:00:25.123Z'), source: 'nbp_average', type: 'average' as const }],
])('preserves official provenance for %s', async (_label, change) => {
  const { record, ctx } = setup()
  await command.execute({ id: recordId, ...change }, ctx)
  expect(record.source).toBe('nbp_average')
  expect(record.externalReference).toBe('011/A/NBP/2024')
})

it('keeps existing unprovenanced manual and custom-source editing', async () => {
  const { record, ctx } = setup({ source: 'custom-provider', externalReference: null })
  await command.execute({ id: recordId, rate: '8.125' }, ctx)
  expect(record).toMatchObject({ rate: '8.125', source: 'custom-provider', externalReference: null })
})

it('does not write or emit side effects for an empty update', async () => {
  const { record, ctx, em, markOrmEntityChange } = setup()
  await command.execute({ id: recordId }, ctx)
  expect(record).toMatchObject({ source: 'nbp_average', externalReference: '011/A/NBP/2024' })
  expect(em.flush).not.toHaveBeenCalled()
  expect(markOrmEntityChange).not.toHaveBeenCalled()
})

it('checks the resulting manual key before a rate-only edit and emits nothing on conflict', async () => {
  const duplicate = setup({ id: '44444444-4444-4444-8444-444444444444', source: 'manual', externalReference: null }).record
  const { record, ctx, em, markOrmEntityChange } = setup({}, [duplicate])
  await expect(command.execute({ id: recordId, rate: '8.125' }, ctx)).rejects.toMatchObject({ status: 409 })
  expect(record).toMatchObject({ source: 'nbp_average', externalReference: '011/A/NBP/2024', rate: '4.12345678901234567890123456789' })
  expect(em.flush).not.toHaveBeenCalled()
  expect(markOrmEntityChange).not.toHaveBeenCalled()
})

it.each(['tenantId', 'organizationId'] as const)('cannot edit or undo a foreign %s record', async (key) => {
  const { record, ctx, em, markOrmEntityChange } = setup({ [key]: '55555555-5555-4555-8555-555555555555' })
  const input = { id: recordId, rate: '8.125' }
  await expect(command.execute(input, ctx)).rejects.toMatchObject({ status: 404 })
  await command.undo!({ input, ctx, logEntry: { commandPayload: { undo: { before: { ...record, rate: '9', date: date.toISOString() } } } } })
  expect(record.rate).toBe('4.12345678901234567890123456789')
  expect(em.flush).not.toHaveBeenCalled()
  expect(markOrmEntityChange).not.toHaveBeenCalled()
})

it('refuses an occupied original publication key before dirtying or flushing either row', async () => {
  const { record, records, ctx, em, markOrmEntityChange } = setup()
  const input = { id: recordId, rate: '8.125' }
  const result = await command.execute(input, ctx)
  const after = await command.captureAfter!(input, result, ctx)
  const log = await command.buildLog!({ input, result, ctx, snapshots: { after } })
  records.push(setup({ id: '44444444-4444-4444-8444-444444444444', deletedAt: new Date(), isActive: false }).record)
  const unchanged = records.map((row) => ({ ...row }))
  em.flush.mockClear()
  markOrmEntityChange.mockClear()
  await expect(command.undo!({ input, ctx, logEntry: { commandPayload: log?.payload } })).rejects.toMatchObject({
    status: 409,
    body: { error: 'This change cannot be undone because another exchange rate now occupies its original currency pair, date, and source.' },
  })
  expect(records).toEqual(unchanged)
  expect(record.rate).toBe('8.125')
  expect(em.flush).not.toHaveBeenCalled()
  expect(markOrmEntityChange).not.toHaveBeenCalled()
})

it.each(['rate', 'metadata', 'updatedAt'] as const)('refuses intervening %s edits before dirtying or flushing', async (field) => {
  const { record, ctx, em, markOrmEntityChange } = setup()
  const input = { id: recordId, rate: '8.125' }
  const result = await command.execute(input, ctx)
  const after = await command.captureAfter!(input, result, ctx)
  const log = await command.buildLog!({ input, result, ctx, snapshots: { after } })
  if (field === 'rate') record.rate = '9.75'
  if (field === 'metadata') record.metadata = { intervening: true }
  if (field === 'updatedAt') record.updatedAt = new Date(record.updatedAt.getTime() + 1)
  const unchanged = { ...record }
  em.flush.mockClear()
  markOrmEntityChange.mockClear()
  await expect(command.undo!({ input, ctx, logEntry: { commandPayload: log?.payload } })).rejects.toMatchObject({ status: 409 })
  expect(record).toEqual(unchanged)
  expect(em.flush).not.toHaveBeenCalled()
  expect(markOrmEntityChange).not.toHaveBeenCalled()
})
