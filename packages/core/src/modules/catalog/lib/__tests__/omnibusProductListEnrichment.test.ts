const reportErrorMock = jest.fn()
const presentedEntriesMock = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }),
}))

jest.mock('../omnibusPresentedEntry', () => {
  const actual = jest.requireActual('../omnibusPresentedEntry')
  return {
    ...actual,
    resolveOmnibusPresentedEntries: (...args: unknown[]) => presentedEntriesMock(...args),
  }
})

import type { EntityManager } from '@mikro-orm/postgresql'
import { attachProductListOmnibusBlocks, type OmnibusProductListEntry } from '../omnibusProductListEnrichment'
import type { OmnibusBlock, OmnibusConfig, OmnibusResolutionRequest } from '../omnibusTypes'
import type { PriceRow, PricingContext } from '../pricing'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const regularKindId = '33333333-3333-4333-8333-333333333333'
const promoKindId = '44444444-4444-4444-8444-444444444444'
const channelId = '55555555-5555-4555-8555-555555555555'

const em = {} as EntityManager

function makePrice(id: string, overrides: Partial<Record<string, unknown>> = {}): PriceRow {
  return {
    id,
    tenantId,
    organizationId,
    currencyCode: 'PLN',
    kind: 'regular',
    minQuantity: 1,
    maxQuantity: null,
    unitPriceNet: '81.3008',
    unitPriceGross: '100.0000',
    channelId: null,
    startsAt: null,
    endsAt: null,
    priceKind: { id: regularKindId, code: 'regular', isPromotion: false },
    product: `product-${id}`,
    variant: null,
    offer: null,
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    updatedAt: new Date('2026-05-01T00:00:00.000Z'),
    ...overrides,
  } as unknown as PriceRow
}

function makeContext(overrides: Partial<PricingContext> = {}): PricingContext {
  return { channelId: null, offerId: null, quantity: 1, date: new Date('2026-06-10T00:00:00.000Z'), ...overrides }
}

function makeEntry(productId: string, best: PriceRow, candidates: PriceRow[] = [best]): OmnibusProductListEntry {
  return { item: {}, productId, best, candidates, context: makeContext() }
}

function makeBlock(overrides: Partial<OmnibusBlock> = {}): OmnibusBlock {
  return {
    presentedPriceKindId: regularKindId,
    lookbackDays: 30,
    minimizationAxis: 'gross',
    promotionAnchorAt: null,
    windowStart: '2026-05-11T00:00:00.000Z',
    windowEnd: '2026-06-10T00:00:00.000Z',
    coverageStartAt: null,
    lowestPriceNet: '81.3008',
    lowestPriceGross: '100.0000',
    previousPriceNet: '81.3008',
    previousPriceGross: '100.0000',
    currencyCode: 'PLN',
    applicable: false,
    applicabilityReason: 'not_announced',
    ...overrides,
  }
}

function makeConfig(overrides: Partial<OmnibusConfig> = {}): OmnibusConfig {
  return {
    enabled: true,
    enabledCountryCodes: ['PL'],
    noChannelMode: 'best_effort',
    lookbackDays: 30,
    minimizationAxis: 'gross',
    backfillCoverage: {},
    channels: {},
    ...overrides,
  }
}

function makeService(config: OmnibusConfig | null) {
  return {
    getConfig: jest.fn(async () => config),
    resolvePresentedPriceKindId: jest.fn(
      (current: OmnibusConfig, channel: string | null | undefined, fallback?: string | null) =>
        (channel ? current.channels[channel]?.presentedPriceKindId : undefined) ??
        current.defaultPresentedPriceKindId ??
        fallback ??
        null,
    ),
    resolveOmnibusBlocks: jest.fn(async (_em: EntityManager, requests: OmnibusResolutionRequest[]) =>
      requests.map((request) => makeBlock({ presentedPriceKindId: request.context.priceKindId ?? null })),
    ),
  }
}

function makeContainer(service: unknown) {
  return {
    resolve: jest.fn((name: string) => {
      if (name === 'catalogOmnibusService') return service
      throw new Error(`unexpected resolve ${name}`)
    }),
  } as unknown as { resolve: <T = unknown>(name: string) => T }
}

describe('attachProductListOmnibusBlocks', () => {
  beforeEach(() => {
    reportErrorMock.mockReset()
    presentedEntriesMock.mockReset()
    presentedEntriesMock.mockImplementation(async (_em: EntityManager, prices: PriceRow[]) => {
      const map = new Map()
      for (const price of prices) {
        map.set(price.id, { priceId: price.id, changeType: 'update', recordedAt: '2026-06-01T00:00:00.000Z' })
      }
      return map
    })
  })

  it('attaches an omnibus block to every priced product with a single batch resolution call', async () => {
    const service = makeService(makeConfig())
    const entries = [makeEntry('prod-1', makePrice('price-1')), makeEntry('prod-2', makePrice('price-2'))]

    await attachProductListOmnibusBlocks({ em, container: makeContainer(service), tenantId, entries })

    expect(service.getConfig).toHaveBeenCalledTimes(1)
    expect(service.getConfig).toHaveBeenCalledWith({ tenantId, organizationId })
    expect(presentedEntriesMock).toHaveBeenCalledTimes(1)
    expect(service.resolveOmnibusBlocks).toHaveBeenCalledTimes(1)
    const requests = service.resolveOmnibusBlocks.mock.calls[0][1]
    expect(requests).toHaveLength(2)
    expect(requests[0]).toMatchObject({
      context: {
        tenantId,
        organizationId,
        productId: 'prod-1',
        priceKindId: regularKindId,
        currencyCode: 'PLN',
        isStorefront: false,
      },
      presentedEntry: { priceId: 'price-1' },
      priceKindIsPromotion: false,
    })
    expect(entries[0].item.omnibus).toMatchObject({ presentedPriceKindId: regularKindId, currencyCode: 'PLN' })
    expect(entries[1].item.omnibus).toBeDefined()
  })

  it('presents the configured price kind and flags promotion kinds', async () => {
    const service = makeService(makeConfig({ defaultPresentedPriceKindId: promoKindId }))
    const regular = makePrice('price-regular')
    const promo = makePrice('price-promo', {
      priceKind: { id: promoKindId, code: 'promo', isPromotion: true },
      unitPriceGross: '80.0000',
    })
    const entry = makeEntry('prod-1', regular, [regular, promo])

    await attachProductListOmnibusBlocks({ em, container: makeContainer(service), tenantId, entries: [entry] })

    const [request] = service.resolveOmnibusBlocks.mock.calls[0][1]
    expect(request.context.priceKindId).toBe(promoKindId)
    expect(request.presentedEntry).toMatchObject({ priceId: 'price-promo' })
    expect(request.priceKindIsPromotion).toBe(true)
  })

  it('uses the price channel when the request carries none', async () => {
    const service = makeService(makeConfig())
    const best = makePrice('price-1', { channelId })
    const entry = { ...makeEntry('prod-1', best), context: makeContext({ channelId: null }) }

    await attachProductListOmnibusBlocks({ em, container: makeContainer(service), tenantId, entries: [entry] })

    expect(service.resolveOmnibusBlocks.mock.calls[0][1][0].context.channelId).toBe(channelId)
  })

  it('skips the history lookup and the resolution service when omnibus is disabled', async () => {
    const service = makeService(makeConfig({ enabled: false }))
    const entries = [makeEntry('prod-1', makePrice('price-1'))]

    await attachProductListOmnibusBlocks({ em, container: makeContainer(service), tenantId, entries })

    expect(service.getConfig).toHaveBeenCalledTimes(1)
    expect(presentedEntriesMock).not.toHaveBeenCalled()
    expect(service.resolveOmnibusBlocks).not.toHaveBeenCalled()
    expect('omnibus' in entries[0].item).toBe(false)
  })

  it('skips the resolution service when the tenant has no omnibus config', async () => {
    const service = makeService(null)
    const entries = [makeEntry('prod-1', makePrice('price-1'))]

    await attachProductListOmnibusBlocks({ em, container: makeContainer(service), tenantId, entries })

    expect(service.resolveOmnibusBlocks).not.toHaveBeenCalled()
    expect('omnibus' in entries[0].item).toBe(false)
  })

  it('does nothing without a tenant or without priced entries', async () => {
    const service = makeService(makeConfig())

    await attachProductListOmnibusBlocks({ em, container: makeContainer(service), tenantId: null, entries: [makeEntry('prod-1', makePrice('price-1'))] })
    await attachProductListOmnibusBlocks({ em, container: makeContainer(service), tenantId, entries: [] })

    expect(service.getConfig).not.toHaveBeenCalled()
    expect(service.resolveOmnibusBlocks).not.toHaveBeenCalled()
  })

  it('omits the block for products whose resolution returned null', async () => {
    const service = makeService(makeConfig())
    service.resolveOmnibusBlocks.mockResolvedValueOnce([makeBlock(), null])
    const entries = [makeEntry('prod-1', makePrice('price-1')), makeEntry('prod-2', makePrice('price-2'))]

    await attachProductListOmnibusBlocks({ em, container: makeContainer(service), tenantId, entries })

    expect(entries[0].item.omnibus).toBeDefined()
    expect('omnibus' in entries[1].item).toBe(false)
  })

  it('never fails the list when the resolution service throws', async () => {
    const service = makeService(makeConfig())
    const failure = new Error('db down')
    service.resolveOmnibusBlocks.mockRejectedValueOnce(failure)
    const entries = [makeEntry('prod-1', makePrice('price-1'))]

    await expect(
      attachProductListOmnibusBlocks({ em, container: makeContainer(service), tenantId, entries }),
    ).resolves.toBeUndefined()

    expect('omnibus' in entries[0].item).toBe(false)
    expect(reportErrorMock).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({ module: 'catalog', code: 'catalog.omnibus_list_enrichment_failed' }),
    )
  })

  it('never fails the list when the service cannot be resolved', async () => {
    const container = {
      resolve: jest.fn(() => {
        throw new Error('not registered')
      }),
    } as unknown as { resolve: <T = unknown>(name: string) => T }
    const entries = [makeEntry('prod-1', makePrice('price-1'))]

    await expect(attachProductListOmnibusBlocks({ em, container, tenantId, entries })).resolves.toBeUndefined()

    expect('omnibus' in entries[0].item).toBe(false)
    expect(reportErrorMock).toHaveBeenCalledTimes(1)
  })
})
