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
