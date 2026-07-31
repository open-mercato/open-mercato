import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  applyOmnibusSnapshotToLine,
  readOmnibusPersonalization,
  readOmnibusSourcePriceId,
  resolveOmnibusService,
  type OmnibusDocumentScope,
  type OmnibusSnapshotTarget,
} from '../omnibusSnapshot'

const tenantId = 'tenant-1'
const organizationId = 'org-1'
const priceId = 'price-1'

const document: OmnibusDocumentScope = {
  tenantId,
  organizationId,
  channelId: 'ch-pl',
  currencyCode: 'PLN',
}

const block = {
  presentedPriceKindId: 'kind-1',
  lookbackDays: 30,
  minimizationAxis: 'gross' as const,
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
  applicabilityReason: 'announced_promotion' as const,
}

type ServiceMocks = {
  resolveOmnibusBlock: jest.Mock
  resolvePresentedEntryForPrice: jest.Mock
}

function makeService(overrides: Partial<ServiceMocks> = {}) {
  const service = {
    resolvePresentedEntryForPrice: jest.fn(async () => ({ id: 'h1', priceId, changeType: 'update' })),
    resolveOmnibusBlock: jest.fn(async () => block),
    ...overrides,
  }
  return service as unknown as Parameters<typeof applyOmnibusSnapshotToLine>[0]['service'] & ServiceMocks
}

function makeEm(price: unknown) {
  const findOne = jest.fn(async () => price)
  return { em: { findOne } as unknown as EntityManager, findOne }
}

const priceRow = {
  id: priceId,
  priceKind: { id: 'kind-1', isPromotion: true },
}

function makeLine(): OmnibusSnapshotTarget {
  return {}
}

describe('readOmnibusSourcePriceId', () => {
  it('prefers an explicit priceId column', () => {
    expect(readOmnibusSourcePriceId({ priceId: 'p-column', metadata: { priceId: 'p-meta' } })).toBe('p-column')
  })

  it('falls back to the line metadata, which is where the upsert path records it', () => {
    expect(readOmnibusSourcePriceId({ metadata: { priceId: 'p-meta' } })).toBe('p-meta')
  })

  it('returns null when neither carries a usable id', () => {
    expect(readOmnibusSourcePriceId({})).toBeNull()
    expect(readOmnibusSourcePriceId({ priceId: '', metadata: { priceId: 42 } })).toBeNull()
  })
})

describe('resolveOmnibusService', () => {
  const makeCtx = (overrides: Record<string, unknown>) => overrides as unknown as CommandRuntimeContext

  it('resolves the service from the container', () => {
    const service = { marker: true }
    const ctx = makeCtx({ container: { resolve: () => service } })
    expect(resolveOmnibusService(ctx)).toBe(service)
  })

  // Rule M-9: a per-line fork + price lookup + history resolve is an N+1 at import scale.
  it('never resolves under bulk import', () => {
    const resolve = jest.fn()
    const ctx = makeCtx({ bulkImport: {}, container: { resolve } })
    expect(resolveOmnibusService(ctx)).toBeNull()
    expect(resolve).not.toHaveBeenCalled()
  })

  // EC-25: sales must degrade to null when the catalog module is absent.
  it('returns null when the container cannot resolve the catalog service', () => {
    const ctx = makeCtx({
      container: {
        resolve: () => {
          throw new Error('not registered')
        },
      },
    })
    expect(resolveOmnibusService(ctx)).toBeNull()
  })

  it('returns null when the container yields undefined', () => {
    const ctx = makeCtx({ container: { resolve: () => undefined } })
    expect(resolveOmnibusService(ctx)).toBeNull()
  })
})

describe('readOmnibusPersonalization', () => {
  it('reads the flags off a resolved block', () => {
    expect(readOmnibusPersonalization({ isPersonalized: true, personalizationReason: 'customer_group_price' })).toEqual({
      isPersonalized: true,
      personalizationReason: 'customer_group_price',
    })
  })

  it('normalises a missing reason to null', () => {
    expect(readOmnibusPersonalization({ isPersonalized: false })).toEqual({
      isPersonalized: false,
      personalizationReason: null,
    })
  })

  it('ignores a block that carries no personalization signal', () => {
    expect(readOmnibusPersonalization({})).toBeNull()
    expect(readOmnibusPersonalization(null)).toBeNull()
    expect(readOmnibusPersonalization('nope')).toBeNull()
  })
})

// Compliance case C14: the six columns are the shop's proof of what the buyer was shown.
describe('applyOmnibusSnapshotToLine', () => {
  it('writes all six snapshot fields from the resolved block', async () => {
    const service = makeService({
      resolveOmnibusBlock: jest.fn(async () => ({
        ...block,
        isPersonalized: true,
        personalizationReason: 'customer_specific_price',
      })),
    })
    const { em } = makeEm(priceRow)
    const line = makeLine()

    await applyOmnibusSnapshotToLine({
      em,
      service,
      line,
      sourceLine: { productId: 'product-1', priceId, currencyCode: 'PLN' },
      document,
      documentKind: 'order',
    })

    expect(line).toEqual({
      omnibusReferenceNet: '81.3008',
      omnibusReferenceGross: '100.0000',
      omnibusPromotionAnchorAt: new Date('2026-06-01T00:00:00.000Z'),
      omnibusApplicabilityReason: 'announced_promotion',
      isPersonalized: true,
      personalizationReason: 'customer_specific_price',
    })
  })

  // Rule M-3 / EC-7: without the presented entry the promo price becomes its own reference.
  it('passes the presented entry and the promotion flag into the resolver', async () => {
    const service = makeService()
    const { em } = makeEm(priceRow)

    await applyOmnibusSnapshotToLine({
      em,
      service,
      line: makeLine(),
      sourceLine: { productId: 'product-1', productVariantId: 'variant-1', priceId },
      document,
      documentKind: 'order',
    })

    expect(service.resolvePresentedEntryForPrice).toHaveBeenCalledWith(em, { tenantId, organizationId }, priceId)
    const [, ctx, presentedEntry, isPromotion] = service.resolveOmnibusBlock.mock.calls[0]
    expect(presentedEntry).toEqual({ id: 'h1', priceId, changeType: 'update' })
    expect(isPromotion).toBe(true)
    expect(ctx).toMatchObject({
      tenantId,
      organizationId,
      productId: 'product-1',
      variantId: 'variant-1',
      channelId: 'ch-pl',
      priceKindId: 'kind-1',
      isStorefront: false,
    })
  })

  it('scopes the price lookup to the document tenant and organization', async () => {
    const service = makeService()
    const { em, findOne } = makeEm(priceRow)

    await applyOmnibusSnapshotToLine({
      em,
      service,
      line: makeLine(),
      sourceLine: { productId: 'product-1', priceId },
      document,
      documentKind: 'order',
    })

    expect(findOne).toHaveBeenCalledWith(
      expect.anything(),
      { id: priceId, organizationId, tenantId },
      { populate: ['priceKind'] },
    )
  })

  it('falls back to the document currency when the line carries none', async () => {
    const service = makeService()
    const { em } = makeEm(priceRow)

    await applyOmnibusSnapshotToLine({
      em,
      service,
      line: makeLine(),
      sourceLine: { productId: 'product-1', priceId },
      document,
      documentKind: 'quote',
    })

    expect(service.resolveOmnibusBlock.mock.calls[0][1]).toMatchObject({ currencyCode: 'PLN' })
  })

  it('leaves the line untouched when the source line has no price reference', async () => {
    const service = makeService()
    const { em, findOne } = makeEm(priceRow)
    const line = makeLine()

    await applyOmnibusSnapshotToLine({
      em,
      service,
      line,
      sourceLine: { productId: 'product-1' },
      document,
      documentKind: 'order',
    })

    expect(line).toEqual({})
    expect(findOne).not.toHaveBeenCalled()
    expect(service.resolveOmnibusBlock).not.toHaveBeenCalled()
  })

  it('leaves the line untouched when the price is not visible in this scope', async () => {
    const service = makeService()
    const { em } = makeEm(null)
    const line = makeLine()

    await applyOmnibusSnapshotToLine({
      em,
      service,
      line,
      sourceLine: { productId: 'product-1', priceId },
      document,
      documentKind: 'order',
    })

    expect(line).toEqual({})
    expect(service.resolveOmnibusBlock).not.toHaveBeenCalled()
  })

  it('leaves the line untouched when omnibus is disabled for the tenant', async () => {
    const service = makeService({ resolveOmnibusBlock: jest.fn(async () => null) })
    const { em } = makeEm(priceRow)
    const line = makeLine()

    await applyOmnibusSnapshotToLine({
      em,
      service,
      line,
      sourceLine: { productId: 'product-1', priceId },
      document,
      documentKind: 'order',
    })

    expect(line).toEqual({})
  })

  it('omits the personalization flags when the block carries no signal', async () => {
    const service = makeService()
    const { em } = makeEm(priceRow)
    const line = makeLine()

    await applyOmnibusSnapshotToLine({
      em,
      service,
      line,
      sourceLine: { productId: 'product-1', priceId },
      document,
      documentKind: 'order',
    })

    expect(line.isPersonalized).toBeUndefined()
    expect(line.personalizationReason).toBeUndefined()
    expect(line.omnibusReferenceGross).toBe('100.0000')
  })

  it('records a null anchor when the reference is not promotion-anchored', async () => {
    const service = makeService({
      resolveOmnibusBlock: jest.fn(async () => ({ ...block, promotionAnchorAt: null })),
    })
    const { em } = makeEm(priceRow)
    const line = makeLine()

    await applyOmnibusSnapshotToLine({
      em,
      service,
      line,
      sourceLine: { productId: 'product-1', priceId },
      document,
      documentKind: 'order',
    })

    expect(line.omnibusPromotionAnchorAt).toBeNull()
  })

  // Best-effort by design: a compliance snapshot must never block an order from being placed.
  it('swallows a resolver failure instead of aborting the document write', async () => {
    const service = makeService({
      resolveOmnibusBlock: jest.fn(async () => {
        throw new Error('history unavailable')
      }),
    })
    const { em } = makeEm(priceRow)
    const line = makeLine()

    await expect(
      applyOmnibusSnapshotToLine({
        em,
        service,
        line,
        sourceLine: { productId: 'product-1', priceId },
        document,
        documentKind: 'order',
      }),
    ).resolves.toBeUndefined()

    expect(line).toEqual({})
  })

  it('swallows a price-lookup failure', async () => {
    const service = makeService()
    const em = {
      findOne: jest.fn(async () => {
        throw new Error('db down')
      }),
    } as unknown as EntityManager

    await expect(
      applyOmnibusSnapshotToLine({
        em,
        service,
        line: makeLine(),
        sourceLine: { productId: 'product-1', priceId },
        document,
        documentKind: 'quote',
      }),
    ).resolves.toBeUndefined()
  })
})
