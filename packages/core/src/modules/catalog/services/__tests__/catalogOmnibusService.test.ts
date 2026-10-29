import type { EntityManager } from '@mikro-orm/postgresql'
import { createCacheService } from '@open-mercato/cache'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  DefaultCatalogOmnibusService,
  evaluateProgressiveCampaign,
  resolveNewArrivalLookbackDays,
  selectOmnibusCandidates,
  selectPrecedingObservation,
} from '../catalogOmnibusService'
import {
  fetchOmnibusCampaignIds,
  fetchOmnibusFirstOfferIds,
  fetchOmnibusPrecedingIds,
  fetchOmnibusWindowIds,
} from '../../lib/omnibusHistoryQueries'
import type {
  OmnibusCampaignLookup,
  OmnibusFirstOfferLookup,
  OmnibusPrecedingLookup,
  OmnibusWindowLookup,
} from '../../lib/omnibusHistoryQueries'
import { invalidateOmnibusCache } from '../../lib/omnibusCache'
import { omnibusConfigSchema } from '../../lib/omnibusTypes'
import type {
  OmnibusHistoryRow,
  OmnibusPresentedEntry,
  OmnibusResolutionContext,
  OmnibusResolutionRequest,
  PriceHistoryChangeType,
} from '../../lib/omnibusTypes'

type MockHistoryRow = {
  id: string
  tenantId: string
  organizationId: string
  priceId: string
  productId: string
  variantId: string | null
  offerId: string | null
  channelId: string | null
  priceKindId: string
  currencyCode: string
  unitPriceNet: string | null
  unitPriceGross: string | null
  startsAt: Date | null
  recordedAt: Date
  changeType: PriceHistoryChangeType
}

const mockHistoryStore: MockHistoryRow[] = []

type MockCatalogRecord = {
  id: string
  tenantId: string
  organizationId: string
  omnibusExempt?: boolean | null
  firstListedAt?: Date | null
  product?: { id: string }
}

const mockCatalogRecords: Record<'CatalogProduct' | 'CatalogProductVariant' | 'CatalogOffer', MockCatalogRecord[]> = {
  CatalogProduct: [],
  CatalogProductVariant: [],
  CatalogOffer: [],
}

function mockScopeValue(row: MockHistoryRow, column: OmnibusWindowLookup['scopeColumn']): string | null {
  if (column === 'product_id') return row.productId
  if (column === 'variant_id') return row.variantId
  return row.offerId
}

function mockNewestFirst(left: MockHistoryRow, right: MockHistoryRow): number {
  const delta = right.recordedAt.getTime() - left.recordedAt.getTime()
  if (delta !== 0) return delta
  return left.id < right.id ? 1 : -1
}

jest.mock('../../lib/omnibusHistoryQueries', () => ({
  OMNIBUS_IN_WINDOW_LIMIT: 1000,
  fetchOmnibusWindowIds: jest.fn(async (_em: unknown, lookups: OmnibusWindowLookup[]) =>
    lookups.map((lookup) => {
      const scoped = mockHistoryStore.filter(
        (row) =>
          row.tenantId === lookup.tenantId &&
          row.organizationId === lookup.organizationId &&
          mockScopeValue(row, lookup.scopeColumn) === lookup.scopeId &&
          (lookup.channelId === null || row.channelId === lookup.channelId) &&
          row.priceKindId === lookup.priceKindId &&
          row.currencyCode === lookup.currencyCode,
      )
      const baseline = scoped
        .filter((row) => row.recordedAt.getTime() <= lookup.windowStart.getTime())
        .sort(mockNewestFirst)[0]
      const inWindow = scoped
        .filter(
          (row) =>
            row.recordedAt.getTime() > lookup.windowStart.getTime() &&
            row.recordedAt.getTime() <= lookup.windowEnd.getTime(),
        )
        .sort(mockNewestFirst)
        .slice(0, 1000)
      return { baselineId: baseline ? baseline.id : null, inWindowIds: inWindow.map((row) => row.id) }
    }),
  ),
  fetchOmnibusFirstOfferIds: jest.fn(async (_em: unknown, lookups: OmnibusFirstOfferLookup[]) =>
    lookups.map((lookup) => {
      const first = mockHistoryStore
        .filter(
          (row) =>
            row.tenantId === lookup.tenantId &&
            row.organizationId === lookup.organizationId &&
            row.offerId === lookup.offerId &&
            row.priceKindId === lookup.priceKindId &&
            row.currencyCode === lookup.currencyCode &&
            row.channelId === lookup.channelId,
        )
        .sort(mockNewestFirst)
        .reverse()[0]
      return first ? first.id : null
    }),
  ),
  fetchOmnibusCampaignIds: jest.fn(async (_em: unknown, lookups: OmnibusCampaignLookup[]) =>
    lookups.map((lookup) => {
      const sameKind = (row: MockHistoryRow) =>
        row.tenantId === lookup.tenantId &&
        row.organizationId === lookup.organizationId &&
        (lookup.channelId === null || row.channelId === lookup.channelId) &&
        row.priceKindId === lookup.priceKindId &&
        row.currencyCode === lookup.currencyCode &&
        row.changeType !== 'delete'
      const campaign = mockHistoryStore
        .filter((row) => sameKind(row) && row.offerId === lookup.offerId)
        .sort(mockNewestFirst)
        .reverse()
      if (!campaign.length) return { campaignIds: [], baselineId: null }
      const startedAt = campaign[0].recordedAt.getTime()
      const baseline = mockHistoryStore
        .filter(
          (row) =>
            sameKind(row) &&
            row.offerId === null &&
            mockScopeValue(row, lookup.baselineScopeColumn) === lookup.baselineScopeId &&
            row.recordedAt.getTime() < startedAt,
        )
        .sort(mockNewestFirst)[0]
      return { campaignIds: campaign.map((row) => row.id), baselineId: baseline ? baseline.id : null }
    }),
  ),
  fetchOmnibusPrecedingIds: jest.fn(async (_em: unknown, lookups: OmnibusPrecedingLookup[]) =>
    lookups.map((lookup) =>
      mockHistoryStore
        .filter(
          (row) =>
            row.tenantId === lookup.tenantId &&
            row.organizationId === lookup.organizationId &&
            mockScopeValue(row, lookup.scopeColumn) === lookup.scopeId &&
            (lookup.channelId === null || row.channelId === lookup.channelId) &&
            row.priceKindId === lookup.priceKindId &&
            row.currencyCode === lookup.currencyCode &&
            row.changeType !== 'delete' &&
            row.recordedAt.getTime() < lookup.before.getTime(),
        )
        .sort(mockNewestFirst)
        .slice(0, 2)
        .map((row) => row.id),
    ),
  ),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(
    async (
      _em: unknown,
      entity: { name?: string },
      where: { id: { $in: string[] }; tenantId: string; organizationId: string },
    ) => {
      const name = entity?.name ?? ''
      const source: Array<{ id: string; tenantId: string; organizationId: string }> =
        name === 'CatalogProduct' || name === 'CatalogProductVariant' || name === 'CatalogOffer'
          ? mockCatalogRecords[name]
          : mockHistoryStore
      return source.filter(
        (row) =>
          where.id.$in.includes(row.id) && row.tenantId === where.tenantId && row.organizationId === where.organizationId,
      )
    },
  ),
}))

const TENANT = '10000000-0000-4000-8000-000000000001'
const ORG = '10000000-0000-4000-8000-000000000002'
const OTHER_ORG = '10000000-0000-4000-8000-000000000003'
const PRODUCT = '20000000-0000-4000-8000-000000000001'
const OTHER_PRODUCT = '20000000-0000-4000-8000-000000000002'
const VARIANT = '20000000-0000-4000-8000-000000000003'
const PRICE_KIND = '30000000-0000-4000-8000-000000000001'
const CHANNEL_KIND = '30000000-0000-4000-8000-000000000002'
const CH_PL = '40000000-0000-4000-8000-000000000001'
const CH_US = '40000000-0000-4000-8000-000000000002'
const CH_DE = '40000000-0000-4000-8000-000000000003'
const CH_NO_COUNTRY = '40000000-0000-4000-8000-000000000004'
const OFFER = '50000000-0000-4000-8000-000000000001'
const PRICE_ROW = '60000000-0000-4000-8000-000000000001'
const PROMO_PRICE_ROW = '60000000-0000-4000-8000-000000000002'
const TODAY = new Date('2026-06-10T12:00:00.000Z')

const em = {} as EntityManager
const windowIdsMock = fetchOmnibusWindowIds as jest.MockedFunction<typeof fetchOmnibusWindowIds>
const firstOfferMock = fetchOmnibusFirstOfferIds as jest.MockedFunction<typeof fetchOmnibusFirstOfferIds>
const campaignIdsMock = fetchOmnibusCampaignIds as jest.MockedFunction<typeof fetchOmnibusCampaignIds>
const precedingIdsMock = fetchOmnibusPrecedingIds as jest.MockedFunction<typeof fetchOmnibusPrecedingIds>
const findMock = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>

let rowCounter = 0

function addRow(input: {
  gross: string | null
  net?: string | null
  recordedAt: string
  priceId?: string
  productId?: string
  variantId?: string | null
  offerId?: string | null
  channelId?: string | null
  priceKindId?: string
  startsAt?: string | null
  changeType?: PriceHistoryChangeType
  organizationId?: string
  id?: string
}): MockHistoryRow {
  rowCounter += 1
  const row: MockHistoryRow = {
    id: input.id ?? `70000000-0000-4000-8000-${String(rowCounter).padStart(12, '0')}`,
    tenantId: TENANT,
    organizationId: input.organizationId ?? ORG,
    priceId: input.priceId ?? PRICE_ROW,
    productId: input.productId ?? PRODUCT,
    variantId: input.variantId ?? null,
    offerId: input.offerId ?? null,
    channelId: input.channelId === undefined ? CH_PL : input.channelId,
    priceKindId: input.priceKindId ?? PRICE_KIND,
    currencyCode: 'PLN',
    unitPriceNet: input.net === undefined ? input.gross : input.net,
    unitPriceGross: input.gross,
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    recordedAt: new Date(input.recordedAt),
    changeType: input.changeType ?? 'update',
  }
  mockHistoryStore.push(row)
  return row
}

function presentedFrom(row: MockHistoryRow): OmnibusPresentedEntry {
  return {
    priceId: row.priceId,
    changeType: row.changeType,
    recordedAt: row.recordedAt,
    startsAt: row.startsAt,
    offerId: row.offerId,
    isAnnounced: Boolean(row.startsAt || row.offerId),
  }
}

function baseConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: true,
    enabledCountryCodes: ['PL'],
    lookbackDays: 30,
    minimizationAxis: 'gross',
    defaultPresentedPriceKindId: PRICE_KIND,
    channels: {
      [CH_PL]: { presentedPriceKindId: PRICE_KIND, countryCode: 'PL' },
      [CH_US]: { presentedPriceKindId: PRICE_KIND, countryCode: 'US' },
      [CH_NO_COUNTRY]: { presentedPriceKindId: PRICE_KIND },
    },
    ...overrides,
  }
}

function configService(value: unknown): ModuleConfigService {
  return {
    getRecord: jest.fn(),
    getValue: jest.fn(async () => value),
    setValue: jest.fn(),
    restoreDefaults: jest.fn(),
    invalidate: jest.fn(),
  } as unknown as ModuleConfigService
}

function buildService(config: unknown = baseConfig(), cache: ReturnType<typeof createCacheService> | null = null) {
  return new DefaultCatalogOmnibusService(configService(config), cache)
}

function ctx(overrides: Partial<OmnibusResolutionContext> = {}): OmnibusResolutionContext {
  return {
    tenantId: TENANT,
    organizationId: ORG,
    productId: PRODUCT,
    channelId: CH_PL,
    priceKindId: PRICE_KIND,
    currencyCode: 'PLN',
    now: TODAY,
    ...overrides,
  }
}

beforeEach(() => {
  mockHistoryStore.length = 0
  mockCatalogRecords.CatalogProduct.length = 0
  mockCatalogRecords.CatalogProductVariant.length = 0
  mockCatalogRecords.CatalogOffer.length = 0
  rowCounter = 0
  windowIdsMock.mockClear()
  firstOfferMock.mockClear()
  campaignIdsMock.mockClear()
  precedingIdsMock.mockClear()
  findMock.mockClear()
})

describe('catalogOmnibusService worked examples', () => {
  it('E1 — standard announced reduction references the price before the promotion', async () => {
    addRow({ gross: '100.00', net: '81.3008', recordedAt: '2026-05-01T09:00:00.456Z', changeType: 'create' })
    const promo = addRow({
      gross: '80.00',
      net: '65.0407',
      recordedAt: '2026-06-01T08:30:00.123Z',
      startsAt: '2026-06-01T00:00:00.000Z',
    })
    const block = await buildService().resolveOmnibusBlock(em, ctx(), presentedFrom(promo))
    expect(block).toEqual({
      presentedPriceKindId: PRICE_KIND,
      lookbackDays: 30,
      minimizationAxis: 'gross',
      promotionAnchorAt: '2026-06-01T00:00:00.000Z',
      windowStart: '2026-05-02T00:00:00.000Z',
      windowEnd: '2026-06-01T00:00:00.000Z',
      coverageStartAt: null,
      lowestPriceNet: '81.3008',
      lowestPriceGross: '100.0000',
      previousPriceNet: '81.3008',
      previousPriceGross: '100.0000',
      currencyCode: 'PLN',
      applicable: true,
      applicabilityReason: 'announced_promotion',
    })
  })

  it('C16 — a promo recorded exactly at starts_at is excluded from its own reference', async () => {
    addRow({ gross: '100.00', recordedAt: '2026-05-20T00:00:00.000Z' })
    const promo = addRow({
      gross: '80.00',
      recordedAt: '2026-06-01T00:00:00.000Z',
      startsAt: '2026-06-01T00:00:00.000Z',
    })
    const block = await buildService().resolveOmnibusBlock(em, ctx(), presentedFrom(promo))
    expect(block?.lowestPriceGross).toBe('100.0000')
    expect(block?.applicabilityReason).toBe('insufficient_history')
  })

  it('EC-7 — a scheduled promo recorded before starts_at is dropped by identity', async () => {
    addRow({ gross: '100.00', recordedAt: '2026-04-01T00:00:00.000Z' })
    const promo = addRow({
      gross: '80.00',
      recordedAt: '2026-05-25T00:00:00.000Z',
      startsAt: '2026-06-01T00:00:00.000Z',
    })
    const block = await buildService().resolveOmnibusBlock(em, ctx(), presentedFrom(promo))
    expect(block?.lowestPriceGross).toBe('100.0000')
    expect(block?.applicabilityReason).toBe('announced_promotion')
  })

  it('EC-7 — a non-anchored promotion kind drops the presented entry from a sliding window', async () => {
    addRow({ gross: '100.00', recordedAt: '2026-05-01T00:00:00.000Z' })
    const promo = addRow({ gross: '80.00', recordedAt: '2026-06-05T00:00:00.000Z', priceId: PROMO_PRICE_ROW })
    const block = await buildService().resolveOmnibusBlock(em, ctx(), { ...presentedFrom(promo), isAnnounced: false }, true)
    expect(block).toMatchObject({
      promotionAnchorAt: null,
      windowEnd: TODAY.toISOString(),
      lowestPriceGross: '100.0000',
      applicable: true,
      applicabilityReason: 'announced_promotion',
    })
  })

  it('E2 — a tax-only change is not announced', async () => {
    addRow({ gross: '100.00', net: '81.30', recordedAt: '2026-05-01T00:00:00.000Z' })
    const taxChange = addRow({ gross: '102.44', net: '81.30', recordedAt: '2026-06-05T00:00:00.000Z' })
    const block = await buildService().resolveOmnibusBlock(em, ctx(), { ...presentedFrom(taxChange), isAnnounced: false })
    expect(block).toMatchObject({ applicable: false, applicabilityReason: 'not_announced' })
  })

  it('E3 — net and gross come from the same lowest-gross row', async () => {
    addRow({ gross: '110.00', net: '90.00', recordedAt: '2026-04-01T00:00:00.000Z' })
    addRow({ gross: '90.00', net: '85.00', recordedAt: '2026-05-20T00:00:00.000Z' })
    addRow({ gross: '95.00', net: '70.00', recordedAt: '2026-06-01T00:00:00.000Z' })
    const block = await buildService().resolveOmnibusBlock(em, ctx(), null, true)
    expect(block).toMatchObject({ lowestPriceNet: '85.0000', lowestPriceGross: '90.0000' })
  })

  it('E4 — the window stays anchored to starts_at on day 45 of the promotion', async () => {
    addRow({ gross: '120.00', recordedAt: '2026-03-20T00:00:00.000Z' })
    addRow({ gross: '110.00', recordedAt: '2026-04-15T00:00:00.000Z' })
    const promo = addRow({ gross: '70.00', recordedAt: '2026-05-01T00:00:00.000Z', startsAt: '2026-05-01T00:00:00.000Z' })
    addRow({ gross: '60.00', recordedAt: '2026-05-20T00:00:00.000Z', priceId: PROMO_PRICE_ROW })
    const day45 = await buildService().resolveOmnibusBlock(
      em,
      ctx({ now: new Date('2026-06-15T00:00:00.000Z') }),
      presentedFrom(promo),
    )
    const day10 = await buildService().resolveOmnibusBlock(
      em,
      ctx({ now: new Date('2026-05-10T00:00:00.000Z') }),
      presentedFrom(promo),
    )
    expect(day45).toMatchObject({
      promotionAnchorAt: '2026-05-01T00:00:00.000Z',
      windowStart: '2026-04-01T00:00:00.000Z',
      windowEnd: '2026-05-01T00:00:00.000Z',
      lowestPriceGross: '110.0000',
      previousPriceGross: '120.0000',
    })
    expect(day45).toEqual(day10)
  })

  it('E5 — without the progressive rule the offer anchors a standard window', async () => {
    const parsed = omnibusConfigSchema.parse(baseConfig())
    addRow({ gross: '100.00', recordedAt: '2026-03-01T00:00:00.000Z' })
    addRow({ gross: '100.00', recordedAt: '2026-04-20T00:00:00.000Z' })
    addRow({ gross: '90.00', recordedAt: '2026-05-01T00:00:00.000Z', offerId: OFFER, priceId: PROMO_PRICE_ROW })
    addRow({ gross: '80.00', recordedAt: '2026-05-05T00:00:00.000Z', offerId: OFFER, priceId: PROMO_PRICE_ROW })
    const current = addRow({ gross: '70.00', recordedAt: '2026-05-09T00:00:00.000Z', offerId: OFFER, priceId: PROMO_PRICE_ROW })
    const block = await buildService(parsed).resolveOmnibusBlock(em, ctx(), presentedFrom(current))
    expect(block).toMatchObject({
      promotionAnchorAt: '2026-05-01T00:00:00.000Z',
      windowStart: '2026-04-01T00:00:00.000Z',
      lowestPriceGross: '100.0000',
      previousPriceGross: '100.0000',
      applicable: true,
      applicabilityReason: 'announced_promotion',
    })
  })

  it('E6 — insufficient history reports the lowest and the oldest in-window rows separately', async () => {
    addRow({ gross: '95.00', recordedAt: '2026-06-02T00:00:00.000Z' })
    addRow({ gross: '90.00', recordedAt: '2026-06-05T00:00:00.000Z' })
    const block = await buildService().resolveOmnibusBlock(em, ctx(), null, true)
    expect(block).toMatchObject({
      lowestPriceGross: '90.0000',
      previousPriceGross: '95.0000',
      coverageStartAt: '2026-06-02T00:00:00.000Z',
      applicabilityReason: 'insufficient_history',
    })
  })

  it('E7 — empty enabledCountryCodes is not_in_eu_market without a query', async () => {
    addRow({ gross: '100.00', recordedAt: '2026-05-01T00:00:00.000Z' })
    const block = await buildService(baseConfig({ enabledCountryCodes: [] })).resolveOmnibusBlock(em, ctx())
    expect(block).toMatchObject({ applicable: false, applicabilityReason: 'not_in_eu_market', lowestPriceGross: null })
    expect(windowIdsMock).not.toHaveBeenCalled()
  })

  it('E7 — a channel country outside enabledCountryCodes is not_in_eu_market without a query', async () => {
    const block = await buildService().resolveOmnibusBlock(em, ctx({ channelId: CH_US }))
    expect(block?.applicabilityReason).toBe('not_in_eu_market')
    expect(windowIdsMock).not.toHaveBeenCalled()
  })

  it('E8 — a storefront without a channel is missing_channel_context regardless of noChannelMode', async () => {
    const block = await buildService(baseConfig({ noChannelMode: 'best_effort' })).resolveOmnibusBlock(
      em,
      ctx({ channelId: null, isStorefront: true }),
    )
    expect(block?.applicabilityReason).toBe('missing_channel_context')
    expect(windowIdsMock).not.toHaveBeenCalled()
  })
})

describe('catalogOmnibusService edge cases', () => {
  it('EC-1 — disabled config returns null without a history query', async () => {
    const service = buildService(baseConfig({ enabled: false }))
    expect(await service.resolveOmnibusBlock(em, ctx())).toBeNull()
    expect(windowIdsMock).not.toHaveBeenCalled()
  })

  it('returns null for an unset or invalid config', async () => {
    expect(await buildService(null).resolveOmnibusBlock(em, ctx())).toBeNull()
    expect(await buildService({ enabled: true, enabledCountryCodes: ['EU'] }).resolveOmnibusBlock(em, ctx())).toBeNull()
    expect(await new DefaultCatalogOmnibusService(null, null).resolveOmnibusBlock(em, ctx())).toBeNull()
  })

  it('EC-3 — a channel without countryCode is treated as non-EU', async () => {
    const block = await buildService().resolveOmnibusBlock(em, ctx({ channelId: CH_NO_COUNTRY }))
    expect(block?.applicabilityReason).toBe('not_in_eu_market')
  })

  it('EC-3 — an unconfigured channel is treated as non-EU', async () => {
    const block = await buildService().resolveOmnibusBlock(em, ctx({ channelId: CH_DE }))
    expect(block?.applicabilityReason).toBe('not_in_eu_market')
  })

  it('EC-4 — admin context without a channel blends all channels in best_effort mode', async () => {
    addRow({ gross: '100.00', recordedAt: '2026-04-01T00:00:00.000Z', channelId: CH_PL })
    addRow({ gross: '85.00', recordedAt: '2026-05-20T00:00:00.000Z', channelId: CH_US })
    const block = await buildService().resolveOmnibusBlock(em, ctx({ channelId: null }), null, true)
    expect(block).toMatchObject({ lowestPriceGross: '85.0000', applicabilityReason: 'announced_promotion' })
  })

  it('require_channel without a channel is missing_channel_context for admin reads', async () => {
    const block = await buildService(baseConfig({ noChannelMode: 'require_channel' })).resolveOmnibusBlock(
      em,
      ctx({ channelId: null }),
    )
    expect(block?.applicabilityReason).toBe('missing_channel_context')
    expect(windowIdsMock).not.toHaveBeenCalled()
  })

  it('EC-6 — no history yields an empty no_history block', async () => {
    const block = await buildService().resolveOmnibusBlock(em, ctx())
    expect(block).toMatchObject({
      applicable: false,
      applicabilityReason: 'no_history',
      lowestPriceNet: null,
      lowestPriceGross: null,
      windowEnd: TODAY.toISOString(),
    })
  })

  it('counts the row in effect at window start as the baseline', async () => {
    addRow({ gross: '70.00', recordedAt: '2026-03-01T00:00:00.000Z' })
    addRow({ gross: '90.00', recordedAt: '2026-05-01T00:00:00.000Z' })
    addRow({ gross: '120.00', recordedAt: '2026-06-01T00:00:00.000Z' })
    const block = await buildService().resolveOmnibusBlock(em, ctx(), null, true)
    expect(block).toMatchObject({
      windowStart: '2026-05-11T12:00:00.000Z',
      lowestPriceGross: '90.0000',
      previousPriceGross: '90.0000',
      coverageStartAt: null,
      applicabilityReason: 'announced_promotion',
    })
  })

  it('EC-12 — null axis values are never selected as lowest', async () => {
    addRow({ gross: '100.00', recordedAt: '2026-04-01T00:00:00.000Z' })
    addRow({ gross: null, net: '10.00', recordedAt: '2026-05-20T00:00:00.000Z' })
    const block = await buildService().resolveOmnibusBlock(em, ctx(), null, true)
    expect(block?.lowestPriceGross).toBe('100.0000')
  })

  it('EC-12 — rows null on the axis everywhere yield no_history', async () => {
    addRow({ gross: null, net: '10.00', recordedAt: '2026-05-20T00:00:00.000Z' })
    const block = await buildService().resolveOmnibusBlock(em, ctx(), null, true)
    expect(block?.applicabilityReason).toBe('no_history')
  })

  it('minimizes on net when the axis is net', async () => {
    addRow({ gross: '90.00', net: '85.00', recordedAt: '2026-04-01T00:00:00.000Z' })
    addRow({ gross: '95.00', net: '70.00', recordedAt: '2026-05-20T00:00:00.000Z' })
    const block = await buildService(baseConfig({ minimizationAxis: 'net' })).resolveOmnibusBlock(em, ctx(), null, true)
    expect(block).toMatchObject({ minimizationAxis: 'net', lowestPriceNet: '70.0000', lowestPriceGross: '95.0000' })
  })

  it('breaks value ties by the earliest recorded row', async () => {
    const earliest = addRow({ gross: '80.00', net: '65.00', recordedAt: '2026-05-15T00:00:00.000Z' })
    addRow({ gross: '80.00', net: '66.00', recordedAt: '2026-05-25T00:00:00.000Z' })
    const result = await buildService().computeLowestPrice(em, ctx(), omnibusConfigSchema.parse(baseConfig()))
    expect(result.lowestRow?.id).toBe(earliest.id)
  })

  it('uses the channel lookback and the channel presented price kind', async () => {
    const config = baseConfig({
      channels: { [CH_PL]: { presentedPriceKindId: CHANNEL_KIND, countryCode: 'PL', lookbackDays: 7 } },
    })
    addRow({ gross: '50.00', recordedAt: '2026-05-20T00:00:00.000Z', priceKindId: PRICE_KIND })
    addRow({ gross: '99.00', recordedAt: '2026-06-01T00:00:00.000Z', priceKindId: CHANNEL_KIND })
    addRow({ gross: '89.00', recordedAt: '2026-06-05T00:00:00.000Z', priceKindId: CHANNEL_KIND })
    const block = await buildService(config).resolveOmnibusBlock(em, ctx(), null, true)
    expect(block).toMatchObject({
      presentedPriceKindId: CHANNEL_KIND,
      lookbackDays: 7,
      windowStart: '2026-06-03T12:00:00.000Z',
      lowestPriceGross: '89.0000',
      previousPriceGross: '99.0000',
    })
  })

  it('falls back to defaultPresentedPriceKindId and then to the requested kind', () => {
    const service = buildService()
    const withDefault = omnibusConfigSchema.parse(baseConfig())
    const withoutDefault = omnibusConfigSchema.parse(baseConfig({ defaultPresentedPriceKindId: undefined }))
    expect(service.resolvePresentedPriceKindId(withDefault, CH_DE, CHANNEL_KIND)).toBe(PRICE_KIND)
    expect(service.resolvePresentedPriceKindId(withoutDefault, CH_DE, CHANNEL_KIND)).toBe(CHANNEL_KIND)
    expect(service.resolvePresentedPriceKindId(withoutDefault, null, null)).toBeNull()
  })

  it('scopes variant resolution to variant history only', async () => {
    addRow({ gross: '40.00', recordedAt: '2026-04-01T00:00:00.000Z' })
    addRow({ gross: '100.00', recordedAt: '2026-04-01T00:00:00.000Z', variantId: VARIANT })
    const block = await buildService().resolveOmnibusBlock(em, ctx({ variantId: VARIANT }), null, true)
    expect(block?.lowestPriceGross).toBe('100.0000')
  })

  it('EC-23 — never reads another organization history', async () => {
    addRow({ gross: '10.00', recordedAt: '2026-04-01T00:00:00.000Z', organizationId: OTHER_ORG })
    const block = await buildService().resolveOmnibusBlock(em, ctx(), null, true)
    expect(block?.applicabilityReason).toBe('no_history')
  })

  it('returns null and reports when the history query fails', async () => {
    windowIdsMock.mockRejectedValueOnce(new Error('db down'))
    const block = await buildService().resolveOmnibusBlock(em, ctx())
    expect(block).toBeNull()
  })
})

describe('catalogOmnibusService cache', () => {
  it('serves repeated resolutions from the cache until the product tag is invalidated', async () => {
    const cache = createCacheService({ strategy: 'memory' })
    const service = buildService(baseConfig(), cache)
    addRow({ gross: '100.00', recordedAt: '2026-04-01T00:00:00.000Z' })
    const first = await service.resolveOmnibusBlock(em, ctx(), null, true)
    addRow({ gross: '60.00', recordedAt: '2026-05-20T00:00:00.000Z' })
    const cached = await service.resolveOmnibusBlock(em, ctx(), null, true)
    expect(cached).toEqual(first)
    expect(windowIdsMock).toHaveBeenCalledTimes(1)
    await invalidateOmnibusCache(cache, [{ tenantId: TENANT, organizationId: ORG, productId: PRODUCT }])
    const refreshed = await service.resolveOmnibusBlock(em, ctx(), null, true)
    expect(refreshed?.lowestPriceGross).toBe('60.0000')
    expect(windowIdsMock).toHaveBeenCalledTimes(2)
  })

  it('keeps anchored and sliding windows in distinct cache entries', async () => {
    const cache = createCacheService({ strategy: 'memory' })
    const service = buildService(baseConfig(), cache)
    addRow({ gross: '100.00', recordedAt: '2026-04-01T00:00:00.000Z' })
    const promo = addRow({ gross: '80.00', recordedAt: '2026-05-20T00:00:00.000Z', startsAt: '2026-06-10T12:00:00.000Z' })
    const sliding = await service.resolveOmnibusBlock(em, ctx(), null, true)
    const anchored = await service.resolveOmnibusBlock(em, ctx(), presentedFrom(promo))
    expect(windowIdsMock).toHaveBeenCalledTimes(2)
    expect(sliding?.promotionAnchorAt).toBeNull()
    expect(anchored?.promotionAnchorAt).toBe('2026-06-10T12:00:00.000Z')
    expect(sliding?.lowestPriceGross).toBe('80.0000')
    expect(anchored?.lowestPriceGross).toBe('100.0000')
  })

  it('does not leak cached results across organizations', async () => {
    const cache = createCacheService({ strategy: 'memory' })
    const service = buildService(baseConfig(), cache)
    addRow({ gross: '100.00', recordedAt: '2026-04-01T00:00:00.000Z' })
    await service.resolveOmnibusBlock(em, ctx(), null, true)
    const other = await service.resolveOmnibusBlock(em, ctx({ organizationId: OTHER_ORG }), null, true)
    expect(other?.applicabilityReason).toBe('no_history')
  })
})

describe('catalogOmnibusService batch resolution', () => {
  function seedMixedHistory(): OmnibusResolutionRequest[] {
    addRow({ gross: '100.00', net: '81.30', recordedAt: '2026-04-01T00:00:00.000Z', changeType: 'create' })
    const promo = addRow({ gross: '80.00', net: '65.04', recordedAt: '2026-06-01T08:30:00.000Z', startsAt: '2026-06-01T00:00:00.000Z' })
    addRow({ gross: '95.00', recordedAt: '2026-06-02T00:00:00.000Z', productId: OTHER_PRODUCT })
    addRow({ gross: '90.00', recordedAt: '2026-06-05T00:00:00.000Z', productId: OTHER_PRODUCT, channelId: CH_US })
    addRow({ gross: '120.00', recordedAt: '2026-03-01T00:00:00.000Z', productId: OTHER_PRODUCT, variantId: VARIANT })
    const offerEntry = addRow({ gross: '70.00', recordedAt: '2026-05-09T00:00:00.000Z', offerId: OFFER, priceId: PROMO_PRICE_ROW })
    addRow({ gross: '75.00', recordedAt: '2026-05-01T00:00:00.000Z', offerId: OFFER, priceId: PROMO_PRICE_ROW })
    return [
      { context: ctx(), presentedEntry: presentedFrom(promo) },
      { context: ctx(), presentedEntry: null, priceKindIsPromotion: true },
      { context: ctx({ productId: OTHER_PRODUCT }), presentedEntry: null },
      { context: ctx({ productId: OTHER_PRODUCT, channelId: null }), presentedEntry: null, priceKindIsPromotion: true },
      { context: ctx({ productId: OTHER_PRODUCT, variantId: VARIANT }), presentedEntry: null },
      { context: ctx(), presentedEntry: presentedFrom(offerEntry) },
      { context: ctx({ channelId: CH_US }), presentedEntry: null },
      { context: ctx({ channelId: null, isStorefront: true }), presentedEntry: null },
      { context: ctx({ productId: '20000000-0000-4000-8000-0000000000ff' }), presentedEntry: null },
    ]
  }

  it('resolves a batch identically to resolving each request on its own', async () => {
    const requests = seedMixedHistory()
    const batch = await buildService().resolveOmnibusBlocks(em, requests)
    windowIdsMock.mockClear()
    const singles = []
    for (const request of requests) {
      singles.push(
        await buildService().resolveOmnibusBlock(
          em,
          request.context,
          request.presentedEntry ?? null,
          request.priceKindIsPromotion === true,
        ),
      )
    }
    expect(batch).toEqual(singles)
    expect(batch.map((block) => block?.applicabilityReason)).toEqual([
      'announced_promotion',
      'announced_promotion',
      'not_announced',
      'announced_promotion',
      'not_announced',
      'announced_promotion',
      'not_in_eu_market',
      'missing_channel_context',
      'no_history',
    ])
  })

  it('serves a whole listing page with one window query, one offer query and one hydrate per phase', async () => {
    const requests = seedMixedHistory()
    await buildService().resolveOmnibusBlocks(em, requests)
    expect(windowIdsMock).toHaveBeenCalledTimes(1)
    expect(firstOfferMock).toHaveBeenCalledTimes(1)
    expect(findMock).toHaveBeenCalledTimes(2)
  })

  it('returns an empty array for an empty batch', async () => {
    expect(await buildService().resolveOmnibusBlocks(em, [])).toEqual([])
  })
})

describe('selectOmnibusCandidates tombstones', () => {
  function historyRow(overrides: Partial<OmnibusHistoryRow> & Pick<OmnibusHistoryRow, 'id' | 'recordedAt'>): OmnibusHistoryRow {
    return {
      priceId: PRICE_ROW,
      changeType: 'update',
      unitPriceNet: null,
      unitPriceGross: '100.0000',
      ...overrides,
    }
  }

  it('ignores delete rows and undo-of-create rows as price observations', () => {
    const baseline = historyRow({ id: 'baseline', recordedAt: '2026-05-01T00:00:00.000Z', unitPriceGross: '100.0000' })
    const selection = selectOmnibusCandidates({
      baseline,
      inWindow: [
        historyRow({ id: 'deleted', recordedAt: '2026-05-20T00:00:00.000Z', changeType: 'delete', unitPriceGross: '10.0000' }),
        historyRow({
          id: 'undone-create',
          recordedAt: '2026-05-21T00:00:00.000Z',
          changeType: 'undo',
          undoneCommand: 'catalog.prices.create',
          unitPriceGross: '20.0000',
        }),
      ],
      presentedEntry: null,
      anchor: null,
      axis: 'gross',
    })
    expect(selection.lowestRow?.id).toBe('baseline')
    expect(selection.previousRow?.id).toBe('baseline')
    expect(selection.insufficientHistory).toBe(false)
  })

  it('does not keep a tombstone baseline and keeps restoring undos as candidates', () => {
    const selection = selectOmnibusCandidates({
      baseline: historyRow({ id: 'deleted-baseline', recordedAt: '2026-05-01T00:00:00.000Z', changeType: 'delete', unitPriceGross: '5.0000' }),
      inWindow: [
        historyRow({
          id: 'undone-delete',
          recordedAt: '2026-05-20T00:00:00.000Z',
          changeType: 'undo',
          undoneCommand: 'catalog.prices.delete',
          unitPriceGross: '90.0000',
        }),
        historyRow({
          id: 'undone-update',
          recordedAt: '2026-05-21T00:00:00.000Z',
          changeType: 'undo',
          undoneCommand: 'catalog.prices.update',
          unitPriceGross: '95.0000',
        }),
      ],
      presentedEntry: null,
      anchor: null,
      axis: 'gross',
    })
    expect(selection.lowestRow?.id).toBe('undone-delete')
    expect(selection.insufficientHistory).toBe(true)
    expect(selection.coverageStartAt).toBe('2026-05-20T00:00:00.000Z')
  })
})

describe('catalogOmnibusService member-state derogations', () => {
  function derogationConfig(channel: Record<string, unknown>): Record<string, unknown> {
    return baseConfig({
      channels: { [CH_PL]: { presentedPriceKindId: PRICE_KIND, countryCode: 'PL', ...channel } },
    })
  }

  function addProgressiveCampaign(offerGrosses: Array<[string, string]>) {
    addRow({ gross: '100.00', recordedAt: '2026-03-01T00:00:00.000Z' })
    addRow({ gross: '100.00', recordedAt: '2026-04-20T00:00:00.000Z' })
    let current: MockHistoryRow | null = null
    for (const [gross, recordedAt] of offerGrosses) {
      current = addRow({ gross, recordedAt, offerId: OFFER, priceId: PROMO_PRICE_ROW })
    }
    return current as MockHistoryRow
  }

  it('E5 — the progressive rule freezes the reference to the price before the first reduction (Art. 6a(5))', async () => {
    const current = addProgressiveCampaign([
      ['90.00', '2026-05-01T00:00:00.000Z'],
      ['80.00', '2026-05-05T00:00:00.000Z'],
      ['70.00', '2026-05-09T00:00:00.000Z'],
    ])
    const block = await buildService(derogationConfig({ progressiveReductionRule: true })).resolveOmnibusBlock(
      em,
      ctx(),
      presentedFrom(current),
    )
    expect(block).toMatchObject({
      applicabilityReason: 'progressive_reduction_frozen',
      applicable: true,
      lowestPriceGross: '100.0000',
      previousPriceGross: '70.0000',
      promotionAnchorAt: '2026-05-01T00:00:00.000Z',
      windowStart: '2026-04-01T00:00:00.000Z',
      windowEnd: '2026-05-01T00:00:00.000Z',
    })
    expect(windowIdsMock).not.toHaveBeenCalled()
  })

  it('falls back to the standard window when the campaign price goes up', async () => {
    const current = addProgressiveCampaign([
      ['90.00', '2026-05-01T00:00:00.000Z'],
      ['95.00', '2026-05-05T00:00:00.000Z'],
      ['70.00', '2026-05-09T00:00:00.000Z'],
    ])
    const block = await buildService(derogationConfig({ progressiveReductionRule: true })).resolveOmnibusBlock(
      em,
      ctx(),
      presentedFrom(current),
    )
    expect(block).toMatchObject({ applicabilityReason: 'announced_promotion', lowestPriceGross: '100.0000' })
    expect(windowIdsMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to the standard window when a pause exceeds progressiveMaxGapDays', async () => {
    const current = addProgressiveCampaign([
      ['90.00', '2026-05-01T00:00:00.000Z'],
      ['80.00', '2026-05-12T00:00:00.000Z'],
    ])
    const service = buildService(derogationConfig({ progressiveReductionRule: true, progressiveMaxGapDays: 10 }))
    const block = await service.resolveOmnibusBlock(em, ctx(), presentedFrom(current))
    expect(block?.applicabilityReason).toBe('announced_promotion')
    const relaxed = buildService(derogationConfig({ progressiveReductionRule: true, progressiveMaxGapDays: 11 }))
    const frozen = await relaxed.resolveOmnibusBlock(em, ctx(), presentedFrom(current))
    expect(frozen?.applicabilityReason).toBe('progressive_reduction_frozen')
  })

  it('perishable goods have no reference on a channel with the exempt rule (Art. 6a(3))', async () => {
    addRow({ gross: '100.00', recordedAt: '2026-05-20T00:00:00.000Z' })
    const block = await buildService(derogationConfig({ perishableGoodsRule: 'exempt' })).resolveOmnibusBlock(
      em,
      ctx({ omnibusExempt: true }),
      null,
      true,
    )
    expect(block).toMatchObject({
      applicabilityReason: 'perishable_exempt',
      applicable: false,
      lowestPriceGross: null,
    })
    expect(windowIdsMock).not.toHaveBeenCalled()
  })

  it('perishable goods reference the price immediately before the reduction under last_price', async () => {
    addRow({ gross: '100.00', recordedAt: '2026-05-01T00:00:00.000Z' })
    addRow({ gross: '120.00', recordedAt: '2026-05-20T00:00:00.000Z' })
    const promo = addRow({
      gross: '90.00',
      recordedAt: '2026-06-05T00:00:00.000Z',
      startsAt: '2026-06-05T00:00:00.000Z',
      priceId: PROMO_PRICE_ROW,
    })
    const service = buildService(derogationConfig({ perishableGoodsRule: 'last_price' }))
    const block = await service.resolveOmnibusBlock(em, ctx({ omnibusExempt: true }), presentedFrom(promo))
    expect(block).toMatchObject({
      applicabilityReason: 'perishable_last_price',
      applicable: true,
      lowestPriceGross: '120.0000',
      previousPriceGross: '120.0000',
      windowEnd: '2026-06-05T00:00:00.000Z',
    })
    const standard = await service.resolveOmnibusBlock(em, ctx({ omnibusExempt: false }), presentedFrom(promo))
    expect(standard).toMatchObject({ applicabilityReason: 'announced_promotion', lowestPriceGross: '100.0000' })
  })

  it('new arrivals use the configured shorter window (Art. 6a(4))', async () => {
    addRow({ gross: '80.00', recordedAt: '2026-05-31T00:00:00.000Z' })
    addRow({ gross: '100.00', recordedAt: '2026-06-01T00:00:00.000Z' })
    const promo = addRow({
      gross: '90.00',
      recordedAt: '2026-06-09T00:00:00.000Z',
      startsAt: '2026-06-09T00:00:00.000Z',
      priceId: PROMO_PRICE_ROW,
    })
    const service = buildService(derogationConfig({ newArrivalRule: 'shorter_window', newArrivalsLookbackDays: 7 }))
    const block = await service.resolveOmnibusBlock(
      em,
      ctx({ firstListedAt: '2026-05-31T00:00:00.000Z' }),
      presentedFrom(promo),
    )
    expect(block).toMatchObject({
      applicabilityReason: 'new_arrival_reduced_window',
      lookbackDays: 7,
      windowStart: '2026-06-02T00:00:00.000Z',
      lowestPriceGross: '100.0000',
    })
    const established = await service.resolveOmnibusBlock(
      em,
      ctx({ firstListedAt: '2026-01-01T00:00:00.000Z' }),
      presentedFrom(promo),
    )
    expect(established).toMatchObject({ applicabilityReason: 'insufficient_history', lookbackDays: 30, lowestPriceGross: '80.0000' })
  })

  it('new arrivals without a configured window use the time on the market', async () => {
    addRow({ gross: '80.00', recordedAt: '2026-05-31T00:00:00.000Z' })
    const promo = addRow({
      gross: '70.00',
      recordedAt: '2026-06-09T00:00:00.000Z',
      startsAt: '2026-06-09T00:00:00.000Z',
      priceId: PROMO_PRICE_ROW,
    })
    const block = await buildService(derogationConfig({ newArrivalRule: 'shorter_window', newArrivalsLookbackDays: null }))
      .resolveOmnibusBlock(em, ctx({ firstListedAt: '2026-05-31T00:00:00.000Z' }), presentedFrom(promo))
    expect(block).toMatchObject({ applicabilityReason: 'new_arrival_reduced_window', lookbackDays: 9, lowestPriceGross: '80.0000' })
  })

  it('loads the exemption from the product and lets a variant override it', async () => {
    mockCatalogRecords.CatalogProduct.push({ id: PRODUCT, tenantId: TENANT, organizationId: ORG, omnibusExempt: true })
    mockCatalogRecords.CatalogProductVariant.push({
      id: VARIANT,
      tenantId: TENANT,
      organizationId: ORG,
      omnibusExempt: null,
      product: { id: PRODUCT },
    })
    addRow({ gross: '100.00', recordedAt: '2026-05-20T00:00:00.000Z', variantId: VARIANT })
    const service = buildService(derogationConfig({ perishableGoodsRule: 'exempt' }))
    const inherited = await service.resolveOmnibusBlock(em, ctx({ productId: null, variantId: VARIANT }), null, true)
    expect(inherited?.applicabilityReason).toBe('perishable_exempt')
    mockCatalogRecords.CatalogProductVariant[0].omnibusExempt = false
    const overridden = await service.resolveOmnibusBlock(em, ctx({ productId: null, variantId: VARIANT }), null, true)
    expect(overridden).toMatchObject({ applicabilityReason: 'insufficient_history', lowestPriceGross: '100.0000' })
  })

  it('does not load product flags when no channel uses a derogation', async () => {
    addRow({ gross: '100.00', recordedAt: '2026-05-20T00:00:00.000Z' })
    await buildService().resolveOmnibusBlock(em, ctx(), null, true)
    const entityNames = findMock.mock.calls.map((call) => (call[1] as { name?: string }).name)
    expect(entityNames).not.toContain('CatalogProduct')
    expect(entityNames).not.toContain('CatalogProductVariant')
  })
})

describe('omnibus derogation helpers', () => {
  function row(id: string, recordedAt: string, gross: string | null, overrides: Partial<OmnibusHistoryRow> = {}): OmnibusHistoryRow {
    return { id, priceId: PRICE_ROW, changeType: 'update', recordedAt, unitPriceNet: gross, unitPriceGross: gross, ...overrides }
  }

  it('does not treat a single offer entry or a start above the baseline as progressive', () => {
    const baseline = row('baseline', '2026-04-01T00:00:00.000Z', '100.00')
    expect(
      evaluateProgressiveCampaign({ campaign: [row('a', '2026-05-01T00:00:00.000Z', '90.00')], baseline, axis: 'gross', maxGapDays: 7 }),
    ).toBeNull()
    expect(
      evaluateProgressiveCampaign({
        campaign: [row('a', '2026-05-01T00:00:00.000Z', '110.00'), row('b', '2026-05-02T00:00:00.000Z', '90.00')],
        baseline,
        axis: 'gross',
        maxGapDays: 7,
      }),
    ).toBeNull()
    expect(
      evaluateProgressiveCampaign({
        campaign: [row('b', '2026-05-02T00:00:00.000Z', '90.00'), row('a', '2026-05-01T00:00:00.000Z', '95.00')],
        baseline: null,
        axis: 'gross',
        maxGapDays: 7,
      }),
    ).toBeNull()
  })

  it('orders the campaign chronologically before checking it', () => {
    const frozen = evaluateProgressiveCampaign({
      campaign: [row('b', '2026-05-02T00:00:00.000Z', '90.00'), row('a', '2026-05-01T00:00:00.000Z', '95.00')],
      baseline: row('baseline', '2026-04-01T00:00:00.000Z', '100.00'),
      axis: 'gross',
      maxGapDays: 7,
    })
    expect(frozen).toEqual({
      lowestRow: expect.objectContaining({ id: 'baseline' }),
      previousRow: expect.objectContaining({ id: 'b' }),
      anchorAt: '2026-05-01T00:00:00.000Z',
    })
  })

  it('skips the presented reduction and tombstones when picking the preceding price', () => {
    const presented: OmnibusPresentedEntry = {
      priceId: PROMO_PRICE_ROW,
      changeType: 'update',
      recordedAt: '2026-06-05T00:00:00.000Z',
    }
    const picked = selectPrecedingObservation(
      [
        row('promo', '2026-06-05T00:00:00.000Z', '90.00', { priceId: PROMO_PRICE_ROW }),
        row('deleted', '2026-06-04T00:00:00.000Z', '10.00', { changeType: 'delete' }),
        row('regular', '2026-06-01T00:00:00.000Z', '120.00'),
      ],
      presented,
    )
    expect(picked?.id).toBe('regular')
  })

  it('shortens the window only for products younger than the lookback', () => {
    const at = new Date('2026-06-10T00:00:00.000Z')
    const shorter = { presentedPriceKindId: PRICE_KIND, newArrivalRule: 'shorter_window' as const }
    expect(resolveNewArrivalLookbackDays({ channelConfig: shorter, firstListedAt: new Date('2026-06-01T00:00:00.000Z'), lookbackDays: 30, at })).toBe(9)
    expect(
      resolveNewArrivalLookbackDays({
        channelConfig: { ...shorter, newArrivalsLookbackDays: 45 },
        firstListedAt: new Date('2026-06-01T00:00:00.000Z'),
        lookbackDays: 30,
        at,
      }),
    ).toBe(30)
    expect(resolveNewArrivalLookbackDays({ channelConfig: shorter, firstListedAt: new Date('2026-06-10T00:00:00.000Z'), lookbackDays: 30, at })).toBe(1)
    expect(resolveNewArrivalLookbackDays({ channelConfig: shorter, firstListedAt: new Date('2026-04-01T00:00:00.000Z'), lookbackDays: 30, at })).toBeNull()
    expect(resolveNewArrivalLookbackDays({ channelConfig: shorter, firstListedAt: null, lookbackDays: 30, at })).toBeNull()
    expect(
      resolveNewArrivalLookbackDays({
        channelConfig: { presentedPriceKindId: PRICE_KIND },
        firstListedAt: new Date('2026-06-01T00:00:00.000Z'),
        lookbackDays: 30,
        at,
      }),
    ).toBeNull()
  })
})
