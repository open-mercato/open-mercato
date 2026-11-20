/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/core'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { Currency, ExchangeRate } from '../../data/entities'
import type { ExchangeRateUpdateInput } from '../../data/validators'
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
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) =>
      entity === Currency ? { code: where.code } : records.find((item) => matches(item, where)) ?? null),
    find: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => records.filter((item) => matches(item, where))),
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
  return { record, em, ctx, markOrmEntityChange, officialLookup }
}

let command: UpdateCommand
beforeAll(() => {
  require('../exchange-rates')
  command = registerCommand.mock.calls.find(([handler]) => handler.id === 'currencies.exchange_rates.update')?.[0] as UpdateCommand
  expect(command).toBeDefined()
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
  const prepared = await command.prepare!(input, ctx)
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
  const log = await command.buildLog!({ input, result, ctx, snapshots: { before: prepared?.before, after } })
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
