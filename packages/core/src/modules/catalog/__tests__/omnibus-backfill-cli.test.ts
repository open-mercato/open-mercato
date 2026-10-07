import type { EntityManager } from '@mikro-orm/postgresql'
import type { CacheStrategy } from '@open-mercato/cache'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { CatalogPriceHistoryEntry, CatalogProductPrice } from '../data/entities'

type Row = Record<string, unknown>

const findWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

import { runOmnibusBackfill, resolveOmnibusBackfillTargets } from '../lib/omnibusBackfill'
import { omnibusConfigSchema } from '../lib/omnibusTypes'
import { omnibusTenantWideTag } from '../lib/omnibusCache'
import { parseOmnibusBackfillArgs } from '../cli'

const TENANT = '22222222-2222-4222-8222-222222222222'
const OTHER_TENANT = '22222222-2222-4222-8222-000000000000'
const ORG = '33333333-3333-4333-8333-333333333333'
const OTHER_ORG = '33333333-3333-4333-8333-000000000000'
const PRODUCT = '44444444-4444-4444-8444-444444444444'
const PRICE_KIND = '77777777-7777-4777-8777-777777777777'
const CHANNEL_PL = '66666666-6666-4666-8666-000000000001'
const CHANNEL_US = '66666666-6666-4666-8666-000000000002'
const NOW = new Date('2026-10-05T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

function priceId(index: number): string {
  return `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`
}

function buildPrice(index: number, overrides: Row = {}): Row {
  return {
    id: priceId(index),
    tenantId: TENANT,
    organizationId: ORG,
    product: { id: PRODUCT },
    variant: null,
    offer: null,
    priceKind: { id: PRICE_KIND, code: 'regular' },
    kind: 'regular',
    currencyCode: 'EUR',
    unitPriceNet: '81.3000',
    unitPriceGross: '100.0000',
    taxRate: '23.0000',
    taxAmount: '18.7000',
    minQuantity: 1,
    maxQuantity: null,
    channelId: null,
    startsAt: null,
    endsAt: null,
    ...overrides,
  }
}

function matchesValue(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    const operators = expected as { $gt?: string; $in?: unknown[] }
    if (operators.$gt !== undefined) return typeof actual === 'string' && actual > operators.$gt
    if (operators.$in !== undefined) return operators.$in.includes(actual)
  }
  return actual === expected
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => matchesValue(row[key], value))
}

type Store = { prices: Row[]; history: Row[] }

function installFindMock(store: Store) {
  findWithDecryptionMock.mockImplementation(
    async (_em: unknown, entity: unknown, where: Row, options: { limit?: number } = {}) => {
      if (entity === CatalogProductPrice) {
        const rows = store.prices
          .filter((row) => matches(row, where))
          .sort((left, right) => String(left.id).localeCompare(String(right.id)))
        return options.limit ? rows.slice(0, options.limit) : rows
      }
      if (entity === CatalogPriceHistoryEntry) {
        return store.history.filter((row) => matches(row, where))
      }
      return []
    },
  )
}

function buildEm(store: Store): EntityManager {
  const pending: Row[] = []
  const historyEm = {
    create: jest.fn((_entity: unknown, data: Row) => ({ id: `h-${store.history.length + pending.length}`, ...data })),
    persist: jest.fn((row: Row) => {
      pending.push(row)
    }),
    flush: jest.fn(async () => {
      store.history.push(...pending.splice(0))
    }),
  }
  return { fork: jest.fn(() => historyEm) } as unknown as EntityManager
}

type FakeConfigService = ModuleConfigService & { stored: Map<string, unknown>; setValue: jest.Mock; getValue: jest.Mock }

function buildConfigService(initial: Record<string, unknown> = {}): FakeConfigService {
  const stored = new Map<string, unknown>(Object.entries(initial))
  const getValue = jest.fn(async (_moduleId: string, _name: string, options?: { scope?: { tenantId?: string | null } }) => {
    const tenantId = options?.scope?.tenantId ?? 'global'
    return stored.has(tenantId) ? stored.get(tenantId) : null
  })
  const setValue = jest.fn(async (_moduleId: string, _name: string, value: unknown, scope?: { tenantId?: string | null }) => {
    stored.set(scope?.tenantId ?? 'global', value)
    return null
  })
  return { stored, getValue, setValue } as unknown as FakeConfigService
}

function buildCache(): CacheStrategy & { deleteByTags: jest.Mock } {
  return { deleteByTags: jest.fn(async () => 0) } as unknown as CacheStrategy & { deleteByTags: jest.Mock }
}

const EU_CONFIG = {
  enabled: false,
  enabledCountryCodes: ['PL'],
  lookbackDays: 30,
  channels: {
    [CHANNEL_PL]: { presentedPriceKindId: PRICE_KIND, countryCode: 'PL', lookbackDays: 45 },
    [CHANNEL_US]: { presentedPriceKindId: PRICE_KIND },
  },
}

beforeEach(() => {
  findWithDecryptionMock.mockReset()
})

describe('runOmnibusBackfill', () => {
  it('creates system baseline rows only for prices without history', async () => {
    const store: Store = {
      prices: [buildPrice(1), buildPrice(2), buildPrice(3)],
      history: [{ id: 'existing', tenantId: TENANT, organizationId: ORG, priceId: priceId(2) }],
    }
    installFindMock(store)
    const configService = buildConfigService()
    const result = await runOmnibusBackfill(
      { em: buildEm(store), moduleConfigService: configService, now: NOW },
      { tenantId: TENANT, unscoped: true },
    )
    const created = store.history.filter((row) => row.id !== 'existing')
    expect(created.map((row) => row.priceId).sort()).toEqual([priceId(1), priceId(3)])
    const expectedRecordedAt = new Date(NOW.getTime() - 30 * DAY_MS - 1)
    for (const row of created) {
      expect(row).toMatchObject({
        tenantId: TENANT,
        organizationId: ORG,
        productId: PRODUCT,
        priceKindId: PRICE_KIND,
        changeType: 'create',
        source: 'system',
        idempotencyKey: null,
      })
      expect((row.recordedAt as Date).toISOString()).toBe(expectedRecordedAt.toISOString())
    }
    expect(result.targets).toEqual([
      expect.objectContaining({ coverageKey: '', scanned: 3, alreadyCovered: 1, missing: 2, created: 2 }),
    ])
  })

  it('is idempotent: a re-run creates no new rows', async () => {
    const store: Store = { prices: [buildPrice(1), buildPrice(2)], history: [] }
    installFindMock(store)
    const deps = { em: buildEm(store), moduleConfigService: buildConfigService(), now: NOW }
    await runOmnibusBackfill(deps, { tenantId: TENANT, unscoped: true })
    expect(store.history).toHaveLength(2)
    const second = await runOmnibusBackfill(deps, { tenantId: TENANT, unscoped: true })
    expect(store.history).toHaveLength(2)
    expect(second.targets[0]).toMatchObject({ scanned: 2, alreadyCovered: 2, missing: 0, created: 0 })
  })

  it('records coverage per EU channel and the unscoped key, preserving the stored config', async () => {
    const store: Store = {
      prices: [
        buildPrice(1, { channelId: CHANNEL_PL }),
        buildPrice(2, { channelId: CHANNEL_US }),
        buildPrice(3, { channelId: null }),
      ],
      history: [],
    }
    installFindMock(store)
    const configService = buildConfigService({ [TENANT]: EU_CONFIG })
    const cache = buildCache()
    const result = await runOmnibusBackfill(
      { em: buildEm(store), moduleConfigService: configService, cache, now: NOW },
      { tenantId: TENANT },
    )
    expect(store.history.map((row) => row.priceId).sort()).toEqual([priceId(1), priceId(3)])
    expect(result.coverageRecorded).toEqual([CHANNEL_PL, ''])
    const saved = omnibusConfigSchema.parse(configService.stored.get(TENANT))
    expect(saved.backfillCoverage).toEqual({
      [CHANNEL_PL]: { completedAt: NOW.toISOString(), lookbackDays: 45 },
      '': { completedAt: NOW.toISOString(), lookbackDays: 45 },
    })
    expect(saved.enabledCountryCodes).toEqual(['PL'])
    expect(Object.keys(saved.channels).sort()).toEqual([CHANNEL_PL, CHANNEL_US].sort())
    expect(configService.setValue).toHaveBeenCalledWith('catalog', 'omnibus', expect.any(Object), { tenantId: TENANT })
    expect(cache.deleteByTags).toHaveBeenCalledWith([omnibusTenantWideTag(TENANT)])
    const channelRow = store.history.find((row) => row.priceId === priceId(1))
    expect((channelRow?.recordedAt as Date).toISOString()).toBe(new Date(NOW.getTime() - 45 * DAY_MS - 1).toISOString())
  })

  it('backfills a single channel and records only that coverage key', async () => {
    const store: Store = {
      prices: [buildPrice(1, { channelId: CHANNEL_US }), buildPrice(2, { channelId: null })],
      history: [],
    }
    installFindMock(store)
    const configService = buildConfigService({
      [TENANT]: { ...EU_CONFIG, backfillCoverage: { [CHANNEL_PL]: { completedAt: '2026-09-01T00:00:00.000Z', lookbackDays: 45 } } },
    })
    const result = await runOmnibusBackfill(
      { em: buildEm(store), moduleConfigService: configService, now: NOW },
      { tenantId: TENANT, channelId: CHANNEL_US },
    )
    expect(store.history.map((row) => row.priceId)).toEqual([priceId(1)])
    expect(result.coverageRecorded).toEqual([CHANNEL_US])
    const saved = omnibusConfigSchema.parse(configService.stored.get(TENANT))
    expect(saved.backfillCoverage).toEqual({
      [CHANNEL_PL]: { completedAt: '2026-09-01T00:00:00.000Z', lookbackDays: 45 },
      [CHANNEL_US]: { completedAt: NOW.toISOString(), lookbackDays: 30 },
    })
  })

  it('dry-run reports counts without writing history, coverage or cache', async () => {
    const store: Store = { prices: [buildPrice(1), buildPrice(2)], history: [] }
    installFindMock(store)
    const em = buildEm(store)
    const configService = buildConfigService()
    const cache = buildCache()
    const result = await runOmnibusBackfill(
      { em, moduleConfigService: configService, cache, now: NOW },
      { tenantId: TENANT, dryRun: true },
    )
    expect(result.dryRun).toBe(true)
    expect(result.targets).toEqual([expect.objectContaining({ coverageKey: '', missing: 2, created: 0 })])
    expect(result.coverageRecorded).toEqual([])
    expect(store.history).toHaveLength(0)
    expect((em as unknown as { fork: jest.Mock }).fork).not.toHaveBeenCalled()
    expect(configService.setValue).not.toHaveBeenCalled()
    expect(cache.deleteByTags).not.toHaveBeenCalled()
  })

  it('never touches prices or config of other tenants and honours the organization filter', async () => {
    const store: Store = {
      prices: [
        buildPrice(1),
        buildPrice(2, { tenantId: OTHER_TENANT }),
        buildPrice(3, { organizationId: OTHER_ORG }),
      ],
      history: [],
    }
    installFindMock(store)
    const configService = buildConfigService({ [OTHER_TENANT]: EU_CONFIG })
    await runOmnibusBackfill(
      { em: buildEm(store), moduleConfigService: configService, now: NOW },
      { tenantId: TENANT, organizationId: ORG },
    )
    expect(store.history.map((row) => row.priceId)).toEqual([priceId(1)])
    for (const call of findWithDecryptionMock.mock.calls) {
      expect(call[2]).toMatchObject({ tenantId: TENANT, organizationId: ORG })
      expect(call[4]).toEqual({ tenantId: TENANT, organizationId: ORG })
    }
    expect(configService.stored.get(OTHER_TENANT)).toBe(EU_CONFIG)
    expect(configService.setValue).toHaveBeenCalledTimes(1)
    expect(configService.setValue.mock.calls[0][3]).toEqual({ tenantId: TENANT })
  })

  it('walks prices in keyset batches', async () => {
    const store: Store = { prices: [1, 2, 3, 4, 5].map((index) => buildPrice(index)), history: [] }
    installFindMock(store)
    const result = await runOmnibusBackfill(
      { em: buildEm(store), moduleConfigService: buildConfigService(), now: NOW },
      { tenantId: TENANT, unscoped: true, batchSize: 2 },
    )
    expect(store.history).toHaveLength(5)
    expect(result.targets[0]).toMatchObject({ scanned: 5, created: 5 })
    const priceCalls = findWithDecryptionMock.mock.calls.filter((call) => call[1] === CatalogProductPrice)
    expect(priceCalls).toHaveLength(3)
    expect(priceCalls[1][2]).toMatchObject({ id: { $gt: priceId(2) } })
  })

  it('skips price rows that cannot produce a complete history entry', async () => {
    const store: Store = { prices: [buildPrice(1, { product: null }), buildPrice(2)], history: [] }
    installFindMock(store)
    const result = await runOmnibusBackfill(
      { em: buildEm(store), moduleConfigService: buildConfigService(), now: NOW },
      { tenantId: TENANT, unscoped: true },
    )
    expect(store.history.map((row) => row.priceId)).toEqual([priceId(2)])
    expect(result.targets[0]).toMatchObject({ skippedIncomplete: 1, created: 1 })
  })

  it('skips individualized and quantity-tier prices', async () => {
    const store: Store = {
      prices: [
        buildPrice(1, { customerId: '99999999-9999-4999-8999-999999999991' }),
        buildPrice(2, { customerGroupId: '99999999-9999-4999-8999-999999999992' }),
        buildPrice(3, { userId: '99999999-9999-4999-8999-999999999993' }),
        buildPrice(4, { userGroupId: '99999999-9999-4999-8999-999999999994' }),
        buildPrice(5, { minQuantity: 10 }),
        buildPrice(6),
      ],
      history: [],
    }
    installFindMock(store)
    const result = await runOmnibusBackfill(
      { em: buildEm(store), moduleConfigService: buildConfigService(), now: NOW },
      { tenantId: TENANT, unscoped: true },
    )
    expect(store.history.map((row) => row.priceId)).toEqual([priceId(6)])
    expect(result.targets[0]).toMatchObject({ scanned: 6, skippedUntracked: 5, missing: 1, created: 1 })
  })

  it('refuses to run against an invalid stored config', async () => {
    const store: Store = { prices: [buildPrice(1)], history: [] }
    installFindMock(store)
    const configService = buildConfigService({ [TENANT]: { lookbackDays: 'thirty' } })
    await expect(
      runOmnibusBackfill({ em: buildEm(store), moduleConfigService: configService, now: NOW }, { tenantId: TENANT }),
    ).rejects.toThrow('[internal]')
    expect(store.history).toHaveLength(0)
    expect(configService.setValue).not.toHaveBeenCalled()
  })
})

describe('resolveOmnibusBackfillTargets', () => {
  const config = omnibusConfigSchema.parse(EU_CONFIG)

  it('uses each in-scope channel lookback and the maximum for unscoped prices', () => {
    expect(resolveOmnibusBackfillTargets(config, {})).toEqual([
      { coverageKey: CHANNEL_PL, channelId: CHANNEL_PL, lookbackDays: 45 },
      { coverageKey: '', channelId: null, lookbackDays: 45 },
    ])
  })

  it('falls back to the global lookback for a single channel without its own', () => {
    expect(resolveOmnibusBackfillTargets(config, { channelId: CHANNEL_US })).toEqual([
      { coverageKey: CHANNEL_US, channelId: CHANNEL_US, lookbackDays: 30 },
    ])
  })
})

describe('parseOmnibusBackfillArgs', () => {
  it('parses tenant, organization, channel, batch size and dry-run', () => {
    const parsed = parseOmnibusBackfillArgs([
      '--dry-run',
      '--tenant',
      TENANT,
      '--org',
      ORG,
      '--channel-id',
      CHANNEL_PL,
      '--batch-size=50',
    ])
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({
      tenantId: TENANT,
      organizationId: ORG,
      channelId: CHANNEL_PL,
      unscoped: false,
      batchSize: 50,
      dryRun: true,
    })
  })

  it('requires a tenant', () => {
    expect(parseOmnibusBackfillArgs(['--dry-run']).success).toBe(false)
  })

  it('rejects combining a channel with unscoped mode', () => {
    expect(parseOmnibusBackfillArgs(['--tenant', TENANT, '--channel-id', CHANNEL_PL, '--unscoped']).success).toBe(false)
  })

  it('rejects a non-numeric batch size', () => {
    expect(parseOmnibusBackfillArgs(['--tenant', TENANT, '--batch-size', 'many']).success).toBe(false)
  })
})
