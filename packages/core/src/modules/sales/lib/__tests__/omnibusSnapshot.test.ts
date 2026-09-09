import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { DefaultCatalogOmnibusService } from '../../../catalog/services/catalogOmnibusService'
import { selectScopeAggregate } from '../../../catalog/services/omnibusAggregate'
import type { OmnibusAggregateExecutor } from '../../../catalog/services/omnibusAggregate'
import type { OmnibusBlock, OmnibusHistoryRow } from '../../../catalog/lib/omnibusTypes'
import {
  applyOmnibusSnapshotToLine,
  readOmnibusSourcePriceId,
  readPricePersonalization,
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

// Typed, not inferred: the finding this file failed to catch was a mock carrying a field the real
// OmnibusBlock has never had. Annotating it makes the compiler the guard against that drift.
const block: OmnibusBlock = {
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

// Art. 6(1)(ea). Derived from the price row that was applied, because OmnibusBlock carries no
// personalization — reading it off the block returned null on every real call and left both
// sales-line columns permanently empty.
describe('readPricePersonalization', () => {
  it('flags a customer-specific price', () => {
    expect(readPricePersonalization({ customerId: 'cust-1' })).toEqual({
      isPersonalized: true,
      personalizationReason: 'customer_specific_price',
    })
  })

  it('flags a customer-group price', () => {
    expect(readPricePersonalization({ customerGroupId: 'grp-1' })).toEqual({
      isPersonalized: true,
      personalizationReason: 'customer_group_price',
    })
  })

  it('flags user and user-group scoped prices', () => {
    expect(readPricePersonalization({ userId: 'u-1' }).personalizationReason).toBe('user_specific_price')
    expect(readPricePersonalization({ userGroupId: 'ug-1' }).personalizationReason).toBe('user_group_price')
  })

  it('reports a public price as not personalized', () => {
    expect(readPricePersonalization({})).toEqual({ isPersonalized: false, personalizationReason: null })
    expect(
      readPricePersonalization({ customerId: null, customerGroupId: null, userId: null, userGroupId: null }),
    ).toEqual({ isPersonalized: false, personalizationReason: null })
  })

  it('prefers the narrowest scope when several are set', () => {
    expect(
      readPricePersonalization({ customerId: 'cust-1', customerGroupId: 'grp-1', userId: 'u-1' })
        .personalizationReason,
    ).toBe('customer_specific_price')
  })
})

// Compliance case C14: the six columns are the shop's proof of what the buyer was shown.
describe('applyOmnibusSnapshotToLine', () => {
  it('writes all six snapshot fields', async () => {
    const service = makeService()
    // A customer-scoped price row is what makes the line personalized — the resolved block
    // never carries that information.
    const { em } = makeEm({ ...priceRow, customerId: 'cust-1' })
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

  it('records a public price as not personalized rather than leaving the columns unset', async () => {
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

    expect(line.isPersonalized).toBe(false)
    expect(line.personalizationReason).toBeNull()
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

// Compliance case C14, second half. The snapshot is the shop's evidence of what
// the buyer was shown at purchase time, so a later catalog price change — or any
// later edit of the same line — must not move it.

/**
 * The snapshot driven by the real resolver rather than a hand-built block.
 *
 * Requested by the PR #5192 review, and it is the test the finding asked for: the helper used to
 * read `isPersonalized` off the resolved block, `OmnibusBlock` has never carried that field, and
 * every existing test passed because it mocked a block shape the service does not produce. A mock
 * cannot catch that class of defect — only running the real service can.
 *
 * The only substitution is the aggregate executor, which needs a database. Everything else is the
 * production object: the same config gating, the same window and anchor derivation, the same
 * candidate selection through `selectScopeAggregate`, and the same `OmnibusBlock` the API returns.
 */
describe('applyOmnibusSnapshotToLine driven by the real CatalogOmnibusService', () => {
  const promoStartsAt = new Date('2026-06-01T00:00:00.000Z')
  const historyRows: OmnibusHistoryRow[] = [
    // Pre-reduction price, in effect when the window opened.
    { id: 'h-base', priceId: 'other-price', changeType: 'create', unitPriceNet: '81.3008', unitPriceGross: '100.0000', recordedAt: '2026-05-02T00:00:00.000Z', startsAt: null, offerId: null, isAnnounced: null },
    // A cheaper price that was withdrawn — never a valid reference (finding 3).
    { id: 'h-gone', priceId: 'other-price', changeType: 'delete', unitPriceNet: '8.1300', unitPriceGross: '10.0000', recordedAt: '2026-05-20T00:00:00.000Z', startsAt: null, offerId: null, isAnnounced: null },
    // The announced reduction itself — excluded from its own window (EC-7).
    { id: 'h-promo', priceId, changeType: 'update', unitPriceNet: '65.0407', unitPriceGross: '80.0000', recordedAt: promoStartsAt.toISOString(), startsAt: promoStartsAt.toISOString(), offerId: null, isAnnounced: true },
  ]

  const toEntity = (row: OmnibusHistoryRow) => ({
    ...row,
    recordedAt: new Date(row.recordedAt),
    startsAt: row.startsAt ? new Date(row.startsAt) : null,
  })

  const aggregateFromRows: OmnibusAggregateExecutor = async (_em, _scope, axis, scopes) =>
    new Map(scopes.map((entry) => [entry.key, selectScopeAggregate(historyRows, entry, axis)]))

  function makeRealService() {
    const moduleConfigService = {
      getValue: jest.fn().mockResolvedValue({
        enabled: true,
        enabledCountryCodes: ['PL'],
        lookbackDays: 30,
        minimizationAxis: 'gross',
        channels: { 'ch-pl': { countryCode: 'PL' } },
      }),
    }
    return new DefaultCatalogOmnibusService(
      moduleConfigService as unknown as ConstructorParameters<typeof DefaultCatalogOmnibusService>[0],
      null,
      aggregateFromRows,
    )
  }

  // `em.find` serves resolvePresentedEntryForPrice (newest entry for the sold price);
  // `em.findOne` serves the price lookup the snapshot does first.
  function makeRealEm(price: unknown) {
    return {
      findOne: jest.fn(async () => price),
      find: jest.fn(async () => [toEntity(historyRows[2]!)]),
    } as unknown as EntityManager
  }

  it('writes a reference the real resolver produced, not one a mock invented', async () => {
    const line = makeLine()
    await applyOmnibusSnapshotToLine({
      em: makeRealEm({ ...priceRow, customerId: 'cust-1' }),
      service: makeRealService(),
      line,
      sourceLine: { productId: 'product-1', priceId, currencyCode: 'PLN' },
      document,
      documentKind: 'order',
    })

    // 100.00, not 80.00: the announced reduction is excluded from its own window (EC-7).
    // And not 10.00: the withdrawn price was never on offer.
    expect(line.omnibusReferenceGross).toBe('100.0000')
    expect(line.omnibusReferenceNet).toBe('81.3008')
    expect(line.omnibusApplicabilityReason).toBe('announced_promotion')
    // The window is frozen to the promotion start, so the reference cannot drift mid-campaign.
    expect(line.omnibusPromotionAnchorAt).toEqual(promoStartsAt)
    // The field the finding was about: it comes from the price row, and the real block has no
    // opinion on it at all.
    expect(line.isPersonalized).toBe(true)
    expect(line.personalizationReason).toBe('customer_specific_price')
  })

  it('records nothing when the tenant has Omnibus disabled, through the real config gate', async () => {
    const moduleConfigService = { getValue: jest.fn().mockResolvedValue({ enabled: false }) }
    const service = new DefaultCatalogOmnibusService(
      moduleConfigService as unknown as ConstructorParameters<typeof DefaultCatalogOmnibusService>[0],
      null,
      aggregateFromRows,
    )
    const line = makeLine()

    await applyOmnibusSnapshotToLine({
      em: makeRealEm(priceRow),
      service,
      line,
      sourceLine: { productId: 'product-1', priceId },
      document,
      documentKind: 'order',
    })

    expect(line).toEqual({})
  })
})

describe('snapshot immutability after the catalog price moves', () => {
  // This helper deliberately has NO internal guard: it overwrites whatever it is
  // given. Immutability therefore lives entirely in the caller condition
  // `!existing && omnibusService && sourceLine.productId` in the document
  // commands. Pinning the overwrite here is what makes that guard load-bearing —
  // if someone ever drops it, an edit to an existing order line would silently
  // re-stamp the legal reference with today's numbers.
  it('overwrites an existing snapshot when invoked, which is why the caller guards on !existing', async () => {
    const alreadyCaptured: OmnibusSnapshotTarget = {
      omnibusReferenceGross: '100.0000',
      omnibusApplicabilityReason: 'announced_promotion',
    }
    const service = makeService({
      resolveOmnibusBlock: jest.fn(async () => ({
        ...block,
        lowestPriceGross: '55.0000',
        applicabilityReason: 'insufficient_history' as const,
      })),
    })
    const { em } = makeEm(priceRow)

    await applyOmnibusSnapshotToLine({
      em,
      service,
      line: alreadyCaptured,
      sourceLine: { productId: 'product-1', priceId },
      document,
      documentKind: 'order',
    })

    expect(alreadyCaptured.omnibusReferenceGross).toBe('55.0000')
    expect(alreadyCaptured.omnibusApplicabilityReason).toBe('insufficient_history')
  })

  it('captures the reference in effect at line creation, not the current catalog price', async () => {
    // The resolver is asked once, at creation. Whatever the catalog does afterwards
    // is irrelevant to the row already written.
    const atPurchaseTime = jest.fn(async () => ({ ...block, lowestPriceGross: '100.0000' }))
    const service = makeService({ resolveOmnibusBlock: atPurchaseTime })
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

    expect(line.omnibusReferenceGross).toBe('100.0000')
    expect(atPurchaseTime).toHaveBeenCalledTimes(1)

    // The resolver is consulted exactly once, at creation. Nothing in this module
    // re-reads it, so a later catalog move cannot reach the stored row.
    expect(atPurchaseTime).toHaveBeenCalledTimes(1)
  })

  it('keeps both document kinds on the same immutable contract', async () => {
    for (const documentKind of ['order', 'quote'] as const) {
      const service = makeService()
      const { em } = makeEm(priceRow)
      const line = makeLine()

      await applyOmnibusSnapshotToLine({
        em,
        service,
        line,
        sourceLine: { productId: 'product-1', priceId },
        document,
        documentKind,
      })

      expect(line.omnibusReferenceGross).toBe('100.0000')
      expect(line.omnibusApplicabilityReason).toBe('announced_promotion')
    }
  })
})
