import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DefaultCatalogOmnibusService } from '../catalogOmnibusService'
import type { OmnibusConfig } from '../../data/validators'
import type { OmnibusHistoryRow, OmnibusResolutionContext } from '../../lib/omnibusTypes'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

const findMock = findWithDecryption as unknown as jest.Mock

type StoredRow = {
  id: string
  priceId: string
  changeType: string
  unitPriceNet: string | null
  unitPriceGross: string | null
  recordedAt: Date
  startsAt: Date | null
  offerId: string | null
  isAnnounced: boolean | null
}

function row(overrides: Partial<StoredRow> & { recordedAt: string; gross?: string | null }): StoredRow {
  return {
    id: overrides.id ?? `row-${overrides.gross ?? 'x'}-${overrides.recordedAt}`,
    priceId: overrides.priceId ?? 'price-1',
    changeType: overrides.changeType ?? 'update',
    unitPriceNet: overrides.unitPriceNet ?? null,
    unitPriceGross: overrides.gross === undefined ? (overrides.unitPriceGross ?? null) : overrides.gross,
    recordedAt: new Date(overrides.recordedAt),
    startsAt: overrides.startsAt ?? null,
    offerId: overrides.offerId ?? null,
    isAnnounced: overrides.isAnnounced ?? null,
  }
}

function makeService(config: OmnibusConfig) {
  const moduleConfigService = { getValue: jest.fn().mockResolvedValue(config) }
  const cache = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined) }
  const service = new DefaultCatalogOmnibusService(
    moduleConfigService as unknown as ConstructorParameters<typeof DefaultCatalogOmnibusService>[0],
    cache as unknown as ConstructorParameters<typeof DefaultCatalogOmnibusService>[1],
  )
  return { service, moduleConfigService, cache }
}

const em = {} as EntityManager

const baseCtx: OmnibusResolutionContext = {
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  productId: 'product-1',
  priceKindId: 'kind-1',
  currencyCode: 'PLN',
  channelId: 'ch-pl',
}

const euConfig: OmnibusConfig = {
  enabled: true,
  enabledCountryCodes: ['PL'],
  lookbackDays: 30,
  minimizationAxis: 'gross',
  channels: { 'ch-pl': { countryCode: 'PL' } },
}

beforeEach(() => findMock.mockReset())

describe('DefaultCatalogOmnibusService.resolveOmnibusBlock — gating', () => {
  it('returns null and issues no query when Omnibus is disabled', async () => {
    const { service } = makeService({ enabled: false })
    await expect(service.resolveOmnibusBlock(em, baseCtx, null, false)).resolves.toBeNull()
    expect(findMock).not.toHaveBeenCalled()
  })

  it('reports not_in_eu_market without querying when no country is enabled', async () => {
    const { service } = makeService({ enabled: true, enabledCountryCodes: [] })
    const block = await service.resolveOmnibusBlock(em, baseCtx, null, false)
    expect(block?.applicabilityReason).toBe('not_in_eu_market')
    expect(block?.lowestPriceGross).toBeNull()
    expect(findMock).not.toHaveBeenCalled()
  })

  it("reports not_in_eu_market when the channel's country is not enabled", async () => {
    const { service } = makeService({
      enabled: true,
      enabledCountryCodes: ['PL'],
      channels: { 'ch-us': { countryCode: 'US' } },
    })
    const block = await service.resolveOmnibusBlock(em, { ...baseCtx, channelId: 'ch-us' }, null, false)
    expect(block?.applicabilityReason).toBe('not_in_eu_market')
    expect(findMock).not.toHaveBeenCalled()
  })

  it('reports missing_channel_context on the storefront when no channel is supplied', async () => {
    const { service } = makeService({ ...euConfig, noChannelMode: 'best_effort' })
    const block = await service.resolveOmnibusBlock(
      em,
      { ...baseCtx, channelId: null, isStorefront: true },
      null,
      false,
    )
    expect(block?.applicabilityReason).toBe('missing_channel_context')
    expect(findMock).not.toHaveBeenCalled()
  })
})

describe('DefaultCatalogOmnibusService.resolveOmnibusBlock — reference selection', () => {
  it('takes net and gross from the SAME lowest-axis row', async () => {
    const { service } = makeService(euConfig)
    findMock
      .mockResolvedValueOnce([]) // baseline
      .mockResolvedValueOnce([
        row({ id: 'a', recordedAt: '2026-06-02T00:00:00.000Z', unitPriceNet: '85', gross: '90' }),
        row({ id: 'b', recordedAt: '2026-06-03T00:00:00.000Z', unitPriceNet: '70', gross: '95' }),
      ])

    const block = await service.resolveOmnibusBlock(em, baseCtx, null, false)

    // Lowest by gross is row A (90). Its net (85) must be reported — never row B's net (70),
    // which would produce a price pair that never existed.
    expect(block?.lowestPriceGross).toBe('90')
    expect(block?.lowestPriceNet).toBe('85')
  })

  it('never selects a row whose axis value is null', async () => {
    const { service } = makeService(euConfig)
    findMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        row({ id: 'no-gross', recordedAt: '2026-06-02T00:00:00.000Z', unitPriceNet: '10', gross: null }),
        row({ id: 'has-gross', recordedAt: '2026-06-03T00:00:00.000Z', unitPriceNet: '80', gross: '99' }),
      ])

    const block = await service.resolveOmnibusBlock(em, baseCtx, null, false)
    expect(block?.lowestPriceGross).toBe('99')
  })

  it('reports no_history when every candidate is null on the axis', async () => {
    const { service } = makeService(euConfig)
    findMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row({ id: 'x', recordedAt: '2026-06-02T00:00:00.000Z', gross: null })])

    const block = await service.resolveOmnibusBlock(em, baseCtx, null, false)
    expect(block?.applicabilityReason).toBe('no_history')
    expect(block?.lowestPriceGross).toBeNull()
  })

  it('flags insufficient_history and exposes coverage when no baseline precedes the window', async () => {
    const { service } = makeService(euConfig)
    findMock
      .mockResolvedValueOnce([]) // no baseline
      .mockResolvedValueOnce([
        row({ id: 'newer', recordedAt: '2026-06-05T00:00:00.000Z', gross: '90' }),
        row({ id: 'older', recordedAt: '2026-06-02T00:00:00.000Z', gross: '95' }),
      ])

    const block = await service.resolveOmnibusBlock(em, baseCtx, null, false)

    // Lowest is the cheapest row (90); coverage starts at the OLDEST row (95 @ 06-02).
    expect(block?.applicabilityReason).toBe('insufficient_history')
    expect(block?.lowestPriceGross).toBe('90')
    expect(block?.previousPriceGross).toBe('95')
    expect(block?.coverageStartAt).toBe('2026-06-02T00:00:00.000Z')
  })

  it('marks a promotional price kind as an announced promotion', async () => {
    const { service } = makeService(euConfig)
    findMock
      .mockResolvedValueOnce([row({ id: 'base', recordedAt: '2026-05-01T00:00:00.000Z', gross: '100' })])
      .mockResolvedValueOnce([])

    const block = await service.resolveOmnibusBlock(em, baseCtx, null, true)
    expect(block?.applicable).toBe(true)
    expect(block?.applicabilityReason).toBe('announced_promotion')
  })

  it('marks a silent repricing as not announced', async () => {
    const { service } = makeService(euConfig)
    findMock
      .mockResolvedValueOnce([row({ id: 'base', recordedAt: '2026-05-01T00:00:00.000Z', gross: '100' })])
      .mockResolvedValueOnce([])

    const block = await service.resolveOmnibusBlock(em, baseCtx, null, false)
    expect(block?.applicable).toBe(false)
    expect(block?.applicabilityReason).toBe('not_announced')
  })
})

// EC-7 / compliance test C16. This is the defect that makes the whole feature legally wrong:
// if the announced reduction stays inside its own reference window it wins MIN, and the shop
// displays the promo price as the "lowest price in the last 30 days".
describe('DefaultCatalogOmnibusService — EC-7: presented reduction excluded from its own window (C16)', () => {
  const presentedAtAnchor: OmnibusHistoryRow = {
    id: 'promo-row',
    priceId: 'price-1',
    changeType: 'update',
    unitPriceNet: '65.0407',
    unitPriceGross: '80',
    recordedAt: '2026-06-01T00:00:00.000Z',
    startsAt: '2026-06-01T00:00:00.000Z',
    offerId: null,
    isAnnounced: true,
  }

  it('uses the pre-reduction price (100) as the reference, not the promo price (80)', async () => {
    const { service } = makeService(euConfig)
    findMock
      .mockResolvedValueOnce([row({ id: 'base', recordedAt: '2026-05-01T00:00:00.000Z', unitPriceNet: '81.3008', gross: '100' })])
      // The inclusive window returns the promo row itself; the candidate filter must drop it.
      .mockResolvedValueOnce([
        row({
          id: 'promo-row',
          priceId: 'price-1',
          changeType: 'update',
          recordedAt: '2026-06-01T00:00:00.000Z',
          startsAt: new Date('2026-06-01T00:00:00.000Z'),
          unitPriceNet: '65.0407',
          gross: '80',
          isAnnounced: true,
        }),
      ])

    const block = await service.resolveOmnibusBlock(em, baseCtx, presentedAtAnchor, false)

    expect(block?.lowestPriceGross).toBe('100')
    expect(block?.lowestPriceNet).toBe('81.3008')
    expect(block?.lowestPriceGross).not.toBe('80')
    expect(block?.applicable).toBe(true)
    expect(block?.applicabilityReason).toBe('announced_promotion')
    expect(block?.promotionAnchorAt).toBe('2026-06-01T00:00:00.000Z')
  })

  it('freezes the window to the promotion start so the reference cannot drift', async () => {
    const { service } = makeService(euConfig)
    findMock.mockResolvedValueOnce([row({ id: 'base', recordedAt: '2026-05-01T00:00:00.000Z', gross: '100' })]).mockResolvedValueOnce([])

    const block = await service.resolveOmnibusBlock(em, baseCtx, presentedAtAnchor, false)

    expect(block?.windowEnd).toBe('2026-06-01T00:00:00.000Z')
    expect(block?.windowStart).toBe('2026-05-02T00:00:00.000Z')
  })

  it('drops any row recorded at or after the anchor, not just the presented one', async () => {
    const { service } = makeService(euConfig)
    findMock
      .mockResolvedValueOnce([row({ id: 'base', recordedAt: '2026-05-01T00:00:00.000Z', gross: '100' })])
      .mockResolvedValueOnce([
        row({ id: 'sibling-cheap', priceId: 'price-2', recordedAt: '2026-06-01T00:00:00.000Z', gross: '50' }),
      ])

    const block = await service.resolveOmnibusBlock(em, baseCtx, presentedAtAnchor, false)
    expect(block?.lowestPriceGross).toBe('100')
  })

  // A promotion flagged only by its price kind has no startsAt, so there is no anchor and the
  // window ends at "now" — the identity rule is the only thing keeping it out of its own set.
  it('excludes a non-anchored promotion by exact identity', async () => {
    const { service } = makeService(euConfig)
    const presentedNoAnchor: OmnibusHistoryRow = { ...presentedAtAnchor, startsAt: null }
    findMock
      .mockResolvedValueOnce([row({ id: 'base', recordedAt: '2026-05-01T00:00:00.000Z', gross: '100' })])
      .mockResolvedValueOnce([
        row({
          id: 'promo-row',
          priceId: 'price-1',
          changeType: 'update',
          recordedAt: '2026-06-01T00:00:00.000Z',
          gross: '80',
        }),
      ])

    const block = await service.resolveOmnibusBlock(em, baseCtx, presentedNoAnchor, true)

    expect(block?.lowestPriceGross).toBe('100')
    expect(block?.promotionAnchorAt).toBeNull()
  })

  it('keeps an unrelated price recorded before the anchor', async () => {
    const { service } = makeService(euConfig)
    findMock
      .mockResolvedValueOnce([row({ id: 'base', recordedAt: '2026-05-01T00:00:00.000Z', gross: '100' })])
      .mockResolvedValueOnce([
        row({ id: 'dip', priceId: 'price-2', recordedAt: '2026-05-20T00:00:00.000Z', gross: '95' }),
      ])

    const block = await service.resolveOmnibusBlock(em, baseCtx, presentedAtAnchor, false)
    expect(block?.lowestPriceGross).toBe('95')
  })
})

describe('DefaultCatalogOmnibusService — progressive reduction (Art. 6a(5))', () => {
  const progressiveConfig: OmnibusConfig = {
    ...euConfig,
    channels: { 'ch-pl': { countryCode: 'PL', progressiveReductionRule: true, progressiveMaxGapDays: 7 } },
  }
  const ctxWithOffer: OmnibusResolutionContext = { ...baseCtx, offerId: 'offer-1' }

  it('freezes the reference to the pre-campaign baseline', async () => {
    const { service } = makeService(progressiveConfig)
    const campaign = [
      row({ id: 'c1', recordedAt: '2026-05-01T00:00:00.000Z', gross: '90', offerId: 'offer-1' }),
      row({ id: 'c2', recordedAt: '2026-05-05T00:00:00.000Z', gross: '80', offerId: 'offer-1' }),
      row({ id: 'c3', recordedAt: '2026-05-09T00:00:00.000Z', gross: '70', offerId: 'offer-1' }),
    ]
    findMock
      .mockResolvedValueOnce([campaign[0]]) // first offer entry
      .mockResolvedValueOnce(campaign) // full offer sequence
      .mockResolvedValueOnce([row({ id: 'pre', recordedAt: '2026-04-20T00:00:00.000Z', gross: '100' })])

    const block = await service.resolveOmnibusBlock(em, ctxWithOffer, null, false)

    expect(block?.applicabilityReason).toBe('progressive_reduction_frozen')
    expect(block?.lowestPriceGross).toBe('100')
    expect(block?.previousPriceGross).toBe('70')
  })

  it('falls through to the standard window when the sequence is interrupted', async () => {
    const { service } = makeService(progressiveConfig)
    const campaign = [
      row({ id: 'c1', recordedAt: '2026-05-01T00:00:00.000Z', gross: '90', offerId: 'offer-1' }),
      row({ id: 'c2', recordedAt: '2026-05-05T00:00:00.000Z', gross: '95', offerId: 'offer-1' }),
      row({ id: 'c3', recordedAt: '2026-05-09T00:00:00.000Z', gross: '80', offerId: 'offer-1' }),
    ]
    findMock
      .mockResolvedValueOnce([campaign[0]])
      .mockResolvedValueOnce(campaign)
      .mockResolvedValueOnce([row({ id: 'base', recordedAt: '2026-04-20T00:00:00.000Z', gross: '100' })])
      .mockResolvedValueOnce(campaign)

    const block = await service.resolveOmnibusBlock(em, ctxWithOffer, null, false)
    expect(block?.applicabilityReason).not.toBe('progressive_reduction_frozen')
  })

  it('falls through when no pre-campaign baseline exists, rather than inventing a reference', async () => {
    const { service } = makeService(progressiveConfig)
    const campaign = [
      row({ id: 'c1', recordedAt: '2026-05-01T00:00:00.000Z', gross: '90', offerId: 'offer-1' }),
      row({ id: 'c2', recordedAt: '2026-05-05T00:00:00.000Z', gross: '80', offerId: 'offer-1' }),
    ]
    findMock
      .mockResolvedValueOnce([campaign[0]])
      .mockResolvedValueOnce(campaign)
      .mockResolvedValueOnce([]) // no pre-campaign baseline
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(campaign)

    const block = await service.resolveOmnibusBlock(em, ctxWithOffer, null, false)
    expect(block?.applicabilityReason).not.toBe('progressive_reduction_frozen')
  })

  it('does not apply the derogation when the channel has not adopted it', async () => {
    const { service } = makeService(euConfig)
    findMock
      .mockResolvedValueOnce([row({ id: 'c1', recordedAt: '2026-05-01T00:00:00.000Z', gross: '90', offerId: 'offer-1' })])
      .mockResolvedValueOnce([row({ id: 'base', recordedAt: '2026-04-20T00:00:00.000Z', gross: '100' })])
      .mockResolvedValueOnce([])

    const block = await service.resolveOmnibusBlock(em, ctxWithOffer, null, false)
    expect(block?.applicabilityReason).not.toBe('progressive_reduction_frozen')
  })
})

describe('DefaultCatalogOmnibusService — perishable goods (Art. 6a(3))', () => {
  it('reports perishable_exempt for an exempt product under the exempt rule', async () => {
    const { service } = makeService({
      ...euConfig,
      channels: { 'ch-pl': { countryCode: 'PL', perishableGoodsRule: 'exempt' } },
    })
    const block = await service.resolveOmnibusBlock(em, { ...baseCtx, omnibusExempt: true }, null, false)
    expect(block?.applicabilityReason).toBe('perishable_exempt')
    expect(block?.lowestPriceGross).toBeNull()
  })

  it('uses the immediately preceding entry under the last_price rule', async () => {
    const { service } = makeService({
      ...euConfig,
      channels: { 'ch-pl': { countryCode: 'PL', perishableGoodsRule: 'last_price' } },
    })
    findMock.mockResolvedValueOnce([row({ id: 'last', recordedAt: '2026-06-01T00:00:00.000Z', gross: '88' })])

    const block = await service.resolveOmnibusBlock(em, { ...baseCtx, omnibusExempt: true }, null, false)
    expect(block?.applicabilityReason).toBe('perishable_last_price')
    expect(block?.lowestPriceGross).toBe('88')
  })

  // EC-7 on the perishable path: the entry on display is normally the newest row in the log,
  // so taking "the newest entry" verbatim makes the reduction its own reference.
  it('excludes the presented reduction and uses the entry before it', async () => {
    const { service } = makeService({
      ...euConfig,
      channels: { 'ch-pl': { countryCode: 'PL', perishableGoodsRule: 'last_price' } },
    })
    const presentedRow = row({ id: 'promo', recordedAt: '2026-06-10T00:00:00.000Z', gross: '7' })
    const priorRow = row({ id: 'before', recordedAt: '2026-06-09T00:00:00.000Z', gross: '10' })

    // Behave like the database: return the log newest-first, honouring a recordedAt bound when
    // the query carries one. Without the bound the promo row is the newest and wins.
    findMock.mockImplementation(async (_em, _entity, where) => {
      const bound = (where as { recordedAt?: { $lt?: Date } }).recordedAt?.$lt
      const rows = [presentedRow, priorRow]
      return bound ? rows.filter((entry) => entry.recordedAt < bound) : rows
    })

    const block = await service.resolveOmnibusBlock(
      em,
      { ...baseCtx, omnibusExempt: true },
      {
        id: presentedRow.id,
        priceId: presentedRow.priceId,
        changeType: presentedRow.changeType,
        unitPriceNet: null,
        unitPriceGross: '7',
        recordedAt: '2026-06-10T00:00:00.000Z',
        startsAt: null,
        offerId: null,
        isAnnounced: true,
      },
      false,
    )

    expect(block?.applicabilityReason).toBe('perishable_last_price')
    expect(block?.lowestPriceGross).toBe('10')
  })

  it('bounds the lookup to entries strictly before the presented price', async () => {
    const { service } = makeService({
      ...euConfig,
      channels: { 'ch-pl': { countryCode: 'PL', perishableGoodsRule: 'last_price' } },
    })
    findMock.mockResolvedValue([row({ id: 'before', recordedAt: '2026-06-09T00:00:00.000Z', gross: '10' })])

    await service.resolveOmnibusBlock(
      em,
      { ...baseCtx, omnibusExempt: true },
      row({ id: 'promo', recordedAt: '2026-06-10T00:00:00.000Z', gross: '7' }),
      false,
    )

    expect(findMock.mock.calls[0][2]).toMatchObject({
      recordedAt: { $lt: new Date('2026-06-10T00:00:00.000Z') },
    })
  })

  it('ignores the rule for a product that is not exempt', async () => {
    const { service } = makeService({
      ...euConfig,
      channels: { 'ch-pl': { countryCode: 'PL', perishableGoodsRule: 'exempt' } },
    })
    findMock
      .mockResolvedValueOnce([row({ id: 'base', recordedAt: '2026-05-01T00:00:00.000Z', gross: '100' })])
      .mockResolvedValueOnce([])

    const block = await service.resolveOmnibusBlock(em, { ...baseCtx, omnibusExempt: false }, null, false)
    expect(block?.applicabilityReason).not.toBe('perishable_exempt')
  })
})

describe('DefaultCatalogOmnibusService — new arrivals (Art. 6a(4))', () => {
  it('shortens the window for a product listed less than the lookback ago', async () => {
    const { service } = makeService({
      ...euConfig,
      channels: { 'ch-pl': { countryCode: 'PL', newArrivalRule: 'shorter_window', newArrivalsLookbackDays: 7 } },
    })
    findMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row({ id: 'r', recordedAt: new Date().toISOString(), gross: '120' })])

    const block = await service.resolveOmnibusBlock(
      em,
      { ...baseCtx, firstListedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) },
      null,
      false,
    )
    expect(block?.lookbackDays).toBe(7)
    expect(block?.applicabilityReason).toBe('new_arrival_reduced_window')
  })

  it('does not fire for a product older than the lookback', async () => {
    const { service } = makeService({
      ...euConfig,
      channels: { 'ch-pl': { countryCode: 'PL', newArrivalRule: 'shorter_window', newArrivalsLookbackDays: 7 } },
    })
    findMock
      .mockResolvedValueOnce([row({ id: 'base', recordedAt: '2026-01-01T00:00:00.000Z', gross: '100' })])
      .mockResolvedValueOnce([])

    const block = await service.resolveOmnibusBlock(
      em,
      { ...baseCtx, firstListedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000) },
      null,
      false,
    )
    expect(block?.lookbackDays).toBe(30)
    expect(block?.applicabilityReason).not.toBe('new_arrival_reduced_window')
  })
})

describe('DefaultCatalogOmnibusService — caching', () => {
  it('tags cached results so a price write can invalidate them precisely', async () => {
    const { service, cache } = makeService(euConfig)
    findMock
      .mockResolvedValueOnce([row({ id: 'base', recordedAt: '2026-05-01T00:00:00.000Z', gross: '100' })])
      .mockResolvedValueOnce([])

    await service.resolveOmnibusBlock(em, { ...baseCtx, variantId: 'variant-1' }, null, false)

    expect(cache.set).toHaveBeenCalledTimes(1)
    const options = cache.set.mock.calls[0][2] as { tags: string[] }
    expect(options.tags).toContain('omnibus:tenant-1:org-1:product:product-1')
    expect(options.tags).toContain('omnibus:tenant-1:org-1:variant:variant-1')
  })

  // Two different presented reductions exclude different rows, so they must not share an entry.
  it('keys the cache by the presented entry identity', async () => {
    const { service, cache } = makeService(euConfig)
    findMock.mockResolvedValue([])

    const presentedA: OmnibusHistoryRow = {
      id: 'a', priceId: 'price-1', changeType: 'update', unitPriceNet: null, unitPriceGross: '80',
      recordedAt: '2026-06-01T00:00:00.000Z', startsAt: null, offerId: null, isAnnounced: true,
    }
    const presentedB: OmnibusHistoryRow = { ...presentedA, id: 'b', priceId: 'price-2' }

    await service.resolveOmnibusBlock(em, baseCtx, presentedA, true)
    await service.resolveOmnibusBlock(em, baseCtx, presentedB, true)

    const keyA = cache.set.mock.calls[0][0] as string
    const keyB = cache.set.mock.calls[1][0] as string
    expect(keyA).not.toBe(keyB)
  })
})

// Compliance case C11. The seeded row must read as "the price already in effect when the
// window opened", not as a change inside the window — otherwise it becomes the reference for
// every product on the day omnibus is switched on.
describe('DefaultCatalogOmnibusService.backfillChannel', () => {
  const priceKind = { id: 'kind-1', code: 'regular' }

  function priceRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'price-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      product: { id: 'product-1' },
      variant: null,
      offer: null,
      channelId: 'ch-pl',
      priceKind,
      currencyCode: 'PLN',
      unitPriceNet: '81.3008',
      unitPriceGross: '100.0000',
      taxRate: '23.0000',
      taxAmount: '18.6992',
      minQuantity: 1,
      maxQuantity: null,
      startsAt: null,
      endsAt: null,
      ...overrides,
    }
  }

  function makeBackfillEm() {
    const persisted: Array<Record<string, unknown>> = []
    const clear = jest.fn()
    const flush = jest.fn().mockResolvedValue(undefined)
    const forked = {
      create: (_entity: unknown, data: Record<string, unknown>) => data,
      persist: (data: Record<string, unknown>) => {
        persisted.push(data)
      },
      flush,
      clear,
    }
    const fork = jest.fn(() => forked)
    const em = { fork } as unknown as EntityManager
    return { em, persisted, fork, flush, clear }
  }

  // findWithDecryption is called twice per batch: prices, then the already-recorded price ids.
  function stubBatches(batches: Array<{ prices: unknown[]; existing?: unknown[] }>) {
    let call = 0
    findMock.mockImplementation(async () => {
      const batch = batches[Math.floor(call / 2)]
      const isPriceQuery = call % 2 === 0
      call += 1
      if (!batch) return []
      return isPriceQuery ? batch.prices : (batch.existing ?? [])
    })
  }

  it('seeds the baseline one millisecond before the window opens', async () => {
    const { service } = makeService({ enabled: true })
    const { em, persisted } = makeBackfillEm()
    stubBatches([{ prices: [priceRow()] }, { prices: [] }])

    const before = Date.now()
    const result = await service.backfillChannel(em, {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      channelId: 'ch-pl',
      lookbackDays: 30,
    })
    const after = Date.now()

    expect(result).toEqual({ inserted: 1, skipped: 0 })
    expect(persisted).toHaveLength(1)
    const recordedAt = (persisted[0].recordedAt as Date).getTime()
    const windowStartLow = before - 30 * 24 * 60 * 60 * 1000
    const windowStartHigh = after - 30 * 24 * 60 * 60 * 1000
    expect(recordedAt).toBeGreaterThanOrEqual(windowStartLow - 1)
    expect(recordedAt).toBeLessThanOrEqual(windowStartHigh - 1)
  })

  it('marks the seeded row as a system create with no idempotency key', async () => {
    const { service } = makeService({ enabled: true })
    const { em, persisted } = makeBackfillEm()
    stubBatches([{ prices: [priceRow()] }, { prices: [] }])

    await service.backfillChannel(em, {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      channelId: 'ch-pl',
      lookbackDays: 30,
    })

    expect(persisted[0]).toMatchObject({
      changeType: 'create',
      source: 'system',
      idempotencyKey: null,
      priceId: 'price-1',
      productId: 'product-1',
      priceKindCode: 'regular',
      currencyCode: 'PLN',
      unitPriceGross: '100.0000',
    })
  })

  it('skips a price that already has history, so a re-run is idempotent', async () => {
    const { service } = makeService({ enabled: true })
    const { em, persisted } = makeBackfillEm()
    stubBatches([{ prices: [priceRow()], existing: [{ priceId: 'price-1' }] }, { prices: [] }])

    const result = await service.backfillChannel(em, {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      channelId: 'ch-pl',
      lookbackDays: 30,
    })

    expect(result).toEqual({ inserted: 0, skipped: 1 })
    expect(persisted).toHaveLength(0)
  })

  it('skips a price whose product cannot be resolved rather than writing an orphan row', async () => {
    const { service } = makeService({ enabled: true })
    const { em, persisted } = makeBackfillEm()
    stubBatches([{ prices: [priceRow({ product: null, variant: null })] }, { prices: [] }])

    const result = await service.backfillChannel(em, {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      channelId: 'ch-pl',
      lookbackDays: 30,
    })

    expect(result).toEqual({ inserted: 0, skipped: 1 })
    expect(persisted).toHaveLength(0)
  })

  it('derives the product from the variant when the price is variant-scoped', async () => {
    const { service } = makeService({ enabled: true })
    const { em, persisted } = makeBackfillEm()
    stubBatches([
      { prices: [priceRow({ product: null, variant: { id: 'variant-1', product: { id: 'product-9' } } })] },
      { prices: [] },
    ])

    await service.backfillChannel(em, {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      channelId: 'ch-pl',
      lookbackDays: 30,
    })

    expect(persisted[0]).toMatchObject({ productId: 'product-9', variantId: 'variant-1' })
  })

  it('scopes the price query to the channel when one is given', async () => {
    const { service } = makeService({ enabled: true })
    const { em } = makeBackfillEm()
    stubBatches([{ prices: [] }])

    await service.backfillChannel(em, {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      channelId: 'ch-pl',
      lookbackDays: 30,
    })

    expect(findMock.mock.calls[0][2]).toEqual({ organizationId: 'org-1', tenantId: 'tenant-1', channelId: 'ch-pl' })
  })

  it('omits the channel filter for an unscoped backfill', async () => {
    const { service } = makeService({ enabled: true })
    const { em } = makeBackfillEm()
    stubBatches([{ prices: [] }])

    await service.backfillChannel(em, {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      channelId: null,
      lookbackDays: 30,
    })

    expect(findMock.mock.calls[0][2]).toEqual({ organizationId: 'org-1', tenantId: 'tenant-1' })
  })

  it('walks every batch until the source is exhausted', async () => {
    const { service } = makeService({ enabled: true })
    const { em, persisted } = makeBackfillEm()
    stubBatches([
      { prices: [priceRow({ id: 'price-1' }), priceRow({ id: 'price-2' })] },
      { prices: [priceRow({ id: 'price-3' })] },
      { prices: [] },
    ])

    const result = await service.backfillChannel(em, {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      channelId: 'ch-pl',
      lookbackDays: 30,
      batchSize: 2,
    })

    expect(result).toEqual({ inserted: 3, skipped: 0 })
    expect(persisted.map((entry) => entry.priceId)).toEqual(['price-1', 'price-2', 'price-3'])
  })
})

describe('DefaultCatalogOmnibusService — request-scoped config memo', () => {
  // The service is registered `.scoped()`, so one products-list request resolves the config
  // once for every row. Without the memo that is one config round-trip per item.
  it('reads the tenant config once even under a concurrent burst', async () => {
    const { service, moduleConfigService } = makeService({ enabled: true, enabledCountryCodes: [] })

    await Promise.all(
      Array.from({ length: 25 }, () => service.resolveOmnibusBlock(em, baseCtx, null, false)),
    )

    expect(moduleConfigService.getValue).toHaveBeenCalledTimes(1)
  })

  it('keeps separate entries per tenant scope', async () => {
    const { service, moduleConfigService } = makeService({ enabled: true, enabledCountryCodes: [] })

    await service.resolveOmnibusBlock(em, baseCtx, null, false)
    await service.resolveOmnibusBlock(em, { ...baseCtx, tenantId: 'tenant-2' }, null, false)

    expect(moduleConfigService.getValue).toHaveBeenCalledTimes(2)
  })

  it('does not memoise a failed read', async () => {
    const { service, moduleConfigService } = makeService({ enabled: true })
    moduleConfigService.getValue
      .mockRejectedValueOnce(new Error('config store down'))
      .mockResolvedValueOnce({ enabled: true, enabledCountryCodes: [] })

    // The first call swallows the failure and degrades to null.
    await expect(service.resolveOmnibusBlock(em, baseCtx, null, false)).resolves.toBeNull()
    const block = await service.resolveOmnibusBlock(em, baseCtx, null, false)

    expect(block?.applicabilityReason).toBe('not_in_eu_market')
    expect(moduleConfigService.getValue).toHaveBeenCalledTimes(2)
  })
})

// A backfilled baseline is a synthetic "price as it stood when the window opened"
// row, not a campaign step. Treating it as the offer anchor freezes the window at
// the moment of the backfill, which pushes every later real reduction outside the
// window and reports no reference at all.
describe('DefaultCatalogOmnibusService — offer anchor ignores backfilled rows', () => {
  const offerCtx: OmnibusResolutionContext = { ...baseCtx, offerId: 'offer-1' }

  const backfilled = {
    ...row({ id: 'seed', recordedAt: '2026-07-12T00:00:00.000Z', gross: '168', offerId: 'offer-1' }),
    changeType: 'create',
    source: 'system',
  }
  const realReduction = {
    ...row({ id: 'promo', recordedAt: '2026-08-11T00:00:00.000Z', gross: '79', offerId: 'offer-1' }),
    changeType: 'update',
    source: 'api',
  }

  // Callers always hand over a mapped row, whose recordedAt is an ISO string.
  const presentedReduction: OmnibusHistoryRow = {
    id: realReduction.id,
    priceId: realReduction.priceId,
    changeType: realReduction.changeType,
    unitPriceNet: null,
    unitPriceGross: '79',
    recordedAt: '2026-08-11T00:00:00.000Z',
    startsAt: null,
    offerId: 'offer-1',
    isAnnounced: null,
  }

  it('does not anchor the window to a system-backfilled entry', async () => {
    const { service } = makeService(euConfig)
    // first-offer-entry probe, then baseline, then in-window
    findMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([backfilled])
      .mockResolvedValueOnce([realReduction])

    const block = await service.resolveOmnibusBlock(em, offerCtx, presentedReduction, false)

    // With no anchor the window ends at `now`, so the pre-reduction price is the
    // reference. Anchoring to the seed row reported no_history instead.
    expect(block?.applicabilityReason).not.toBe('no_history')
    expect(block?.lowestPriceGross).toBe('168')
  })

  it('excludes backfilled rows from the offer-anchor query', async () => {
    const { service } = makeService(euConfig)
    findMock.mockResolvedValue([])

    await service.resolveOmnibusBlock(em, offerCtx, realReduction, false)

    expect(findMock.mock.calls[0][2]).toMatchObject({ source: { $ne: 'system' } })
  })

  it('reports the anchor it actually used even when no reference is found', async () => {
    const { service } = makeService(euConfig)
    const anchored = {
      ...row({ id: 'campaign', recordedAt: '2026-08-01T00:00:00.000Z', gross: '90', offerId: 'offer-1' }),
      changeType: 'update',
      source: 'api',
    }
    findMock
      .mockResolvedValueOnce([anchored])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const block = await service.resolveOmnibusBlock(em, offerCtx, anchored, false)

    // An empty block that hides the anchor contradicts its own window bounds.
    expect(block?.applicabilityReason).toBe('no_history')
    expect(block?.promotionAnchorAt).toBe('2026-08-01T00:00:00.000Z')
    expect(block?.windowEnd).toBe('2026-08-01T00:00:00.000Z')
  })
})

// Compliance case C9. Two channels selling the same product keep separate
// histories, so a reduction announced on one must never borrow the other's
// reference — that would let a shop prove a discount with a price it never
// offered in that market.
describe('DefaultCatalogOmnibusService — per-channel isolation (C9)', () => {
  const twoChannelConfig: OmnibusConfig = {
    enabled: true,
    enabledCountryCodes: ['PL', 'DE'],
    lookbackDays: 30,
    minimizationAxis: 'gross',
    channels: {
      'ch-pl': { countryCode: 'PL' },
      'ch-de': { countryCode: 'DE' },
    },
  }

  it('scopes every history query to the requested channel', async () => {
    const { service } = makeService(twoChannelConfig)
    findMock.mockResolvedValue([])

    await service.resolveOmnibusBlock(em, { ...baseCtx, channelId: 'ch-de' }, null, false)

    for (const call of findMock.mock.calls) {
      expect(call[2]).toMatchObject({ channelId: { $eq: 'ch-de' } })
    }
  })

  it('resolves a different reference for each channel', async () => {
    const { service } = makeService(twoChannelConfig)
    const byChannel: Record<string, string> = { 'ch-pl': '100', 'ch-de': '80' }

    findMock.mockImplementation(async (_em, _entity, where) => {
      const channelId = (where as { channelId?: { $eq?: string } }).channelId?.$eq ?? ''
      const gross = byChannel[channelId]
      // Only the baseline probe returns a row; the in-window scan stays empty.
      const isBaseline = Boolean((where as { recordedAt?: { $lte?: Date } }).recordedAt?.$lte)
      return isBaseline && gross
        ? [row({ id: `base-${channelId}`, recordedAt: '2026-05-01T00:00:00.000Z', gross })]
        : []
    })

    const pl = await service.resolveOmnibusBlock(em, { ...baseCtx, channelId: 'ch-pl' }, null, false)
    const de = await service.resolveOmnibusBlock(em, { ...baseCtx, channelId: 'ch-de' }, null, false)

    expect(pl?.lowestPriceGross).toBe('100')
    expect(de?.lowestPriceGross).toBe('80')
  })

  it('gives the two channels distinct cache keys', async () => {
    const { service, cache } = makeService(twoChannelConfig)
    findMock.mockResolvedValue([])

    await service.resolveOmnibusBlock(em, { ...baseCtx, channelId: 'ch-pl' }, null, false)
    await service.resolveOmnibusBlock(em, { ...baseCtx, channelId: 'ch-de' }, null, false)

    const keys = cache.set.mock.calls.map((call) => call[0] as string)
    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe(keys[1])
  })

  it('blends channels only when none is supplied and the mode allows it', async () => {
    const { service } = makeService({ ...twoChannelConfig, noChannelMode: 'best_effort' })
    findMock.mockResolvedValue([])

    await service.resolveOmnibusBlock(em, { ...baseCtx, channelId: null }, null, false)

    for (const call of findMock.mock.calls) {
      expect(call[2]).not.toHaveProperty('channelId')
    }
  })
})

// Compliance case C2, resolution half. A tax-only change carries no announcement
// signal — no validity start, no offer, is_announced false, non-promotional kind —
// so the block must come back not applicable. Rendering a "was X" next to a price
// that moved only because VAT moved would be an invented reduction.
describe('DefaultCatalogOmnibusService — tax-only change (C2)', () => {
  const taxOnlyChange: OmnibusHistoryRow = {
    id: 'vat-change',
    priceId: 'price-1',
    changeType: 'update',
    unitPriceNet: '81.3008',
    unitPriceGross: '87.8049',
    recordedAt: '2026-06-10T00:00:00.000Z',
    startsAt: null,
    offerId: null,
    isAnnounced: false,
  }

  it('reports not_announced and applicable=false', async () => {
    const { service } = makeService(euConfig)
    findMock
      .mockResolvedValueOnce([row({ id: 'base', recordedAt: '2026-05-01T00:00:00.000Z', gross: '100' })])
      .mockResolvedValueOnce([])

    const block = await service.resolveOmnibusBlock(em, baseCtx, taxOnlyChange, false)

    expect(block?.applicable).toBe(false)
    expect(block?.applicabilityReason).toBe('not_announced')
  })

  it('does not anchor the window to a change nobody announced', async () => {
    const { service } = makeService(euConfig)
    findMock
      .mockResolvedValueOnce([row({ id: 'base', recordedAt: '2026-05-01T00:00:00.000Z', gross: '100' })])
      .mockResolvedValueOnce([])

    const block = await service.resolveOmnibusBlock(em, baseCtx, taxOnlyChange, false)

    // No startsAt and no offer means no campaign, so the window keeps sliding.
    expect(block?.promotionAnchorAt).toBeNull()
  })

  it('flips to announced once the same price is given a validity start', async () => {
    const { service } = makeService(euConfig)
    findMock
      .mockResolvedValueOnce([row({ id: 'base', recordedAt: '2026-05-01T00:00:00.000Z', gross: '100' })])
      .mockResolvedValueOnce([])

    const announced = { ...taxOnlyChange, startsAt: '2026-06-10T00:00:00.000Z', isAnnounced: true }
    const block = await service.resolveOmnibusBlock(em, baseCtx, announced, false)

    // Same row, same price — only the announcement signal differs. This is the
    // control that proves the previous two assertions are about the signal and
    // not about some unrelated gating.
    expect(block?.applicable).toBe(true)
    expect(block?.applicabilityReason).toBe('announced_promotion')
  })
})

// Review finding 3. `delete` records the value a price held as it was withdrawn, and the undo of
// a `create` records the value being removed. Neither was ever on offer at that point, so neither
// may become the legal reference — a fat-fingered price that is immediately undone would otherwise
// be a permanent candidate.
describe('DefaultCatalogOmnibusService — withdrawn prices are not reference candidates', () => {
  it('excludes delete and undo rows from the SQL candidate query', async () => {
    const { service } = makeService(euConfig)
    findMock.mockResolvedValue([])

    await service.resolveOmnibusBlock(em, baseCtx, null, false)

    for (const call of findMock.mock.calls) {
      expect(call[2]).toMatchObject({ changeType: { $in: ['create', 'update'] } })
    }
  })

  it('ignores a stray withdrawn row that reaches the candidate set', async () => {
    const { service } = makeService(euConfig)
    findMock
      .mockResolvedValueOnce([row({ id: 'base', recordedAt: '2026-05-01T00:00:00.000Z', gross: '100' })])
      .mockResolvedValueOnce([
        { ...row({ id: 'undone', recordedAt: '2026-06-02T00:00:00.000Z', gross: '1' }), changeType: 'undo' },
        { ...row({ id: 'removed', recordedAt: '2026-06-03T00:00:00.000Z', gross: '2' }), changeType: 'delete' },
      ])

    const block = await service.resolveOmnibusBlock(em, baseCtx, null, false)

    // The 1.00 typo and the 2.00 withdrawal must not win over the genuine 100.00 baseline.
    expect(block?.lowestPriceGross).toBe('100')
  })
})

// Review finding 2. The cap has to shed rows once a scope exceeds it. Shedding the oldest — what a
// recordedAt ordering does — throws away the rows most likely to hold the minimum and yields a
// reference price that is too high, with nothing to signal it.
describe('DefaultCatalogOmnibusService — in-window row cap', () => {
  it('orders the scan by the minimisation axis so the cap sheds the most expensive rows', async () => {
    const { service } = makeService(euConfig)
    findMock.mockResolvedValue([])

    await service.resolveOmnibusBlock(em, baseCtx, null, false)

    const inWindowCall = findMock.mock.calls.find((call) => {
      const where = call[2] as { recordedAt?: Record<string, unknown> }
      return Boolean(where.recordedAt && '$gt' in where.recordedAt)
    })
    expect(inWindowCall).toBeDefined()
    expect((inWindowCall![3] as { orderBy: unknown[] }).orderBy[0]).toEqual({ unitPriceGross: 'ASC' })
  })

  it('orders by net when that is the configured axis', async () => {
    const { service } = makeService({ ...euConfig, minimizationAxis: 'net' })
    findMock.mockResolvedValue([])

    await service.resolveOmnibusBlock(em, baseCtx, null, false)

    const inWindowCall = findMock.mock.calls.find((call) => {
      const where = call[2] as { recordedAt?: Record<string, unknown> }
      return Boolean(where.recordedAt && '$gt' in where.recordedAt)
    })
    expect((inWindowCall![3] as { orderBy: unknown[] }).orderBy[0]).toEqual({ unitPriceNet: 'ASC' })
  })

  it('reports insufficient history when the scan is truncated', async () => {
    const { service } = makeService(euConfig)
    const full = Array.from({ length: 1000 }, (_, index) =>
      row({ id: `r${index}`, recordedAt: '2026-06-02T00:00:00.000Z', gross: String(50 + index) }),
    )
    findMock
      .mockResolvedValueOnce([row({ id: 'base', recordedAt: '2026-05-01T00:00:00.000Z', gross: '100' })])
      .mockResolvedValueOnce(full)

    const block = await service.resolveOmnibusBlock(em, baseCtx, null, false)

    // The minimum is still trustworthy — it survives the cap by construction — but the window is
    // no longer fully represented, so the block must not look complete.
    expect(block?.lowestPriceGross).toBe('50')
    expect(block?.applicabilityReason).toBe('insufficient_history')
  })
})

// Review finding 4. The batch exists to cut queries, so the thing worth pinning is that it does
// not change the answer — and that anything it cannot cover still falls back to a real query.
describe('DefaultCatalogOmnibusService — page-wide history prefetch', () => {
  const productA = { ...baseCtx, productId: 'product-a' }
  const productB = { ...baseCtx, productId: 'product-b' }

  // Relative to now: the prefetch filters each product's slice against its real window, so fixed
  // calendar dates would fall outside it and the rows would be correctly discarded.
  const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const rowFor = (productId: string, gross: string, recordedAt: string, id: string) => ({
    ...row({ id, recordedAt, gross }),
    productId,
    priceKindId: 'kind-1',
    currencyCode: 'PLN',
  })
  const IN_WINDOW_AT = daysAgo(5)
  const BASELINE_AT = daysAgo(40)

  it('issues two queries for a page instead of two per product', async () => {
    const { service } = makeService(euConfig)
    findMock.mockResolvedValue([])

    await service.prefetchHistoryForProducts(em, [
      { ctx: productA, presentedPriceEntry: null },
      { ctx: productB, presentedPriceEntry: null },
    ])

    expect(findMock).toHaveBeenCalledTimes(2)
  })

  it('gives each product only the rows from its own scope', async () => {
    const { service } = makeService(euConfig)
    findMock
      .mockResolvedValueOnce([
        rowFor('product-a', '90', IN_WINDOW_AT, 'a-in'),
        rowFor('product-b', '70', IN_WINDOW_AT, 'b-in'),
      ])
      .mockResolvedValueOnce([
        rowFor('product-a', '100', BASELINE_AT, 'a-base'),
        rowFor('product-b', '200', BASELINE_AT, 'b-base'),
      ])

    const prefetch = await service.prefetchHistoryForProducts(em, [
      { ctx: productA, presentedPriceEntry: null },
      { ctx: productB, presentedPriceEntry: null },
    ])

    expect(prefetch.inWindow.get('product-a|kind-1|PLN')?.map((r) => r.id)).toEqual(['a-in'])
    expect(prefetch.inWindow.get('product-b|kind-1|PLN')?.map((r) => r.id)).toEqual(['b-in'])
    expect(prefetch.baseline.get('product-a|kind-1|PLN')?.unitPriceGross).toBe('100')
    expect(prefetch.baseline.get('product-b|kind-1|PLN')?.unitPriceGross).toBe('200')
  })

  it('resolves to the same block with and without the prefetch', async () => {
    const inWindow = [rowFor('product-a', '90', IN_WINDOW_AT, 'a-in')]
    const baseline = [rowFor('product-a', '100', BASELINE_AT, 'a-base')]

    const direct = makeService(euConfig)
    findMock.mockResolvedValueOnce(baseline).mockResolvedValueOnce(inWindow)
    const withoutPrefetch = await direct.service.resolveOmnibusBlock(em, productA, null, false)

    const batched = makeService(euConfig)
    findMock.mockResolvedValueOnce(inWindow).mockResolvedValueOnce(baseline)
    const prefetch = await batched.service.prefetchHistoryForProducts(em, [
      { ctx: productA, presentedPriceEntry: null },
    ])
    const withPrefetch = await batched.service.resolveOmnibusBlock(em, productA, null, false, prefetch)

    expect(withPrefetch?.lowestPriceGross).toBe(withoutPrefetch?.lowestPriceGross)
    expect(withPrefetch?.applicabilityReason).toBe(withoutPrefetch?.applicabilityReason)
    expect(withPrefetch?.previousPriceGross).toBe(withoutPrefetch?.previousPriceGross)
  })

  it('falls back to a per-scope query for a product the batch did not cover', async () => {
    const { service } = makeService(euConfig)
    // Empty batch: no key present, so the resolver must not treat that as "no history".
    findMock.mockResolvedValue([])
    const prefetch = await service.prefetchHistoryForProducts(em, [{ ctx: productA, presentedPriceEntry: null }])
    findMock.mockReset()
    findMock
      .mockResolvedValueOnce([rowFor('product-c', '100', BASELINE_AT, 'c-base')])
      .mockResolvedValueOnce([])

    const block = await service.resolveOmnibusBlock(
      em,
      { ...baseCtx, productId: 'product-c' },
      null,
      false,
      prefetch,
    )

    expect(findMock).toHaveBeenCalled()
    expect(block?.lowestPriceGross).toBe('100')
  })

  it('skips products whose scope takes a derogation path', async () => {
    const { service } = makeService({
      ...euConfig,
      channels: { 'ch-pl': { countryCode: 'PL', perishableGoodsRule: 'last_price' } },
    })
    findMock.mockResolvedValue([])

    const prefetch = await service.prefetchHistoryForProducts(em, [
      { ctx: { ...productA, omnibusExempt: true }, presentedPriceEntry: null },
    ])

    // Left out of the batch on purpose — the perishable branch does its own bounded read.
    expect(prefetch.inWindow.has('product-a|kind-1|PLN')).toBe(false)
  })
})
