import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { DefaultCatalogOmnibusService } from '../../../catalog/services/catalogOmnibusService'
import type {
  OmnibusLatestPriceEntryLookup,
  OmnibusWindowLookup,
} from '../../../catalog/lib/omnibusHistoryQueries'
import type { OmnibusBlock, PriceHistoryChangeType } from '../../../catalog/lib/omnibusTypes'
import {
  applyOmnibusSnapshotToLine,
  readOmnibusSourcePriceId,
  readPricePersonalization,
  resolveOmnibusService,
  type OmnibusDocumentScope,
  type OmnibusSnapshotTarget,
} from '../omnibusSnapshot'

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
  isAnnounced: boolean | null
  metadata: Record<string, unknown> | null
}

const mockHistoryStore: MockHistoryRow[] = []

function mockNewestFirst(left: MockHistoryRow, right: MockHistoryRow): number {
  const delta = right.recordedAt.getTime() - left.recordedAt.getTime()
  if (delta !== 0) return delta
  return left.id < right.id ? 1 : -1
}

function mockScopeValue(row: MockHistoryRow, column: OmnibusWindowLookup['scopeColumn']): string | null {
  if (column === 'product_id') return row.productId
  if (column === 'variant_id') return row.variantId
  return row.offerId
}

jest.mock('../../../catalog/lib/omnibusHistoryQueries', () => ({
  OMNIBUS_IN_WINDOW_LIMIT: 1000,
  fetchOmnibusWindowIds: jest.fn(async (_em: unknown, lookups: OmnibusWindowLookup[]) =>
    lookups.map((lookup) => {
      const scoped = mockHistoryStore.filter(
        (row) =>
          row.tenantId === lookup.tenantId &&
          row.organizationId === lookup.organizationId &&
          mockScopeValue(row, lookup.scopeColumn) === lookup.scopeId &&
          (lookup.channelId === null || row.channelId === null || row.channelId === lookup.channelId) &&
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
      return { baselineId: baseline ? baseline.id : null, inWindowIds: inWindow.map((row) => row.id) }
    }),
  ),
  fetchOmnibusFirstOfferIds: jest.fn(async (_em: unknown, lookups: unknown[]) => lookups.map(() => null)),
  fetchOmnibusLatestPriceEntryIds: jest.fn(async (_em: unknown, lookups: OmnibusLatestPriceEntryLookup[]) =>
    lookups.map((lookup) => {
      const latest = mockHistoryStore
        .filter((row) => row.priceId === lookup.priceId && row.tenantId === lookup.tenantId)
        .sort(mockNewestFirst)[0]
      return latest ? latest.id : null
    }),
  ),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(async (_em: unknown, _entity: unknown, where: { id?: { $in?: string[] } }) => {
    const ids = new Set(where.id?.$in ?? [])
    return mockHistoryStore.filter((row) => ids.has(row.id))
  }),
}))

const mockFindOne = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const productId = '33333333-3333-4333-8333-333333333333'
const variantId = '44444444-4444-4444-8444-444444444444'
const priceId = '55555555-5555-4555-8555-555555555555'
const otherPriceId = '66666666-6666-4666-8666-666666666666'
const priceKindId = '77777777-7777-4777-8777-777777777777'
const channelId = '88888888-8888-4888-8888-888888888888'

const document: OmnibusDocumentScope = { tenantId, organizationId, channelId, currencyCode: 'PLN' }

const em = { fork: () => em } as unknown as EntityManager

const block: OmnibusBlock = {
  presentedPriceKindId: priceKindId,
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
}

type PriceFixture = {
  id: string
  tenantId: string
  organizationId: string
  currencyCode: string
  startsAt: Date | null
  updatedAt: Date
  createdAt: Date
  channelId: string | null
  priceKind: { id: string; isPromotion: boolean }
  customerId?: string | null
  customerGroupId?: string | null
  userId?: string | null
  userGroupId?: string | null
}

function makePrice(overrides: Partial<PriceFixture> = {}): PriceFixture {
  return {
    id: priceId,
    tenantId,
    organizationId,
    currencyCode: 'PLN',
    startsAt: null,
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    channelId: null,
    priceKind: { id: priceKindId, isPromotion: true },
    ...overrides,
  }
}

function makeService(resolveOmnibusBlock: jest.Mock = jest.fn(async () => block)) {
  const service = { resolveOmnibusBlock } as unknown as Parameters<typeof applyOmnibusSnapshotToLine>[0]['service']
  return { service, resolveOmnibusBlock }
}

function historyRow(overrides: Partial<MockHistoryRow> & Pick<MockHistoryRow, 'id' | 'recordedAt'>): MockHistoryRow {
  return {
    tenantId,
    organizationId,
    priceId: otherPriceId,
    productId,
    variantId: null,
    offerId: null,
    channelId: null,
    priceKindId,
    currencyCode: 'PLN',
    unitPriceNet: null,
    unitPriceGross: null,
    startsAt: null,
    changeType: 'update',
    isAnnounced: null,
    metadata: null,
    ...overrides,
  }
}

beforeEach(() => {
  mockHistoryStore.length = 0
  mockFindOne.mockReset()
})

describe('readOmnibusSourcePriceId', () => {
  it('prefers an explicit priceId', () => {
    expect(readOmnibusSourcePriceId({ priceId: 'p-column', metadata: { priceId: 'p-meta' } })).toBe('p-column')
  })

  it('falls back to the line metadata, where the upsert path records it', () => {
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
    expect(resolveOmnibusService(makeCtx({ container: { resolve: () => service } }))).toBe(service)
  })

  it('never resolves under bulk import', () => {
    const resolve = jest.fn()
    expect(resolveOmnibusService(makeCtx({ bulkImport: {}, container: { resolve } }))).toBeNull()
    expect(resolve).not.toHaveBeenCalled()
  })

  it('returns null when the catalog module is absent', () => {
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
    expect(resolveOmnibusService(makeCtx({ container: { resolve: () => undefined } }))).toBeNull()
  })
})

describe('readPricePersonalization', () => {
  it('flags customer, customer-group, user and user-group prices', () => {
    expect(readPricePersonalization({ customerId: 'c' })).toEqual({
      isPersonalized: true,
      personalizationReason: 'customer_specific_price',
    })
    expect(readPricePersonalization({ customerGroupId: 'g' }).personalizationReason).toBe('customer_group_price')
    expect(readPricePersonalization({ userId: 'u' }).personalizationReason).toBe('user_specific_price')
    expect(readPricePersonalization({ userGroupId: 'ug' }).personalizationReason).toBe('user_group_price')
  })

  it('reports a public price as not personalized', () => {
    expect(readPricePersonalization({})).toEqual({ isPersonalized: false, personalizationReason: null })
    expect(
      readPricePersonalization({ customerId: null, customerGroupId: null, userId: null, userGroupId: null }),
    ).toEqual({ isPersonalized: false, personalizationReason: null })
  })

  it('prefers the narrowest scope when several are set', () => {
    expect(
      readPricePersonalization({ customerId: 'c', customerGroupId: 'g', userId: 'u' }).personalizationReason,
    ).toBe('customer_specific_price')
  })
})

describe('applyOmnibusSnapshotToLine', () => {
  it('writes all six snapshot fields', async () => {
    mockFindOne.mockResolvedValue(makePrice({ customerId: 'cust-1' }) as never)
    const { service } = makeService()
    const line: OmnibusSnapshotTarget = {}

    await applyOmnibusSnapshotToLine({
      em,
      service,
      line,
      sourceLine: { productId, priceId, currencyCode: 'PLN' },
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

  it('passes the sold price as the presented entry, with its promotion flag, to the resolver', async () => {
    const recordedAt = new Date('2026-06-01T00:00:00.000Z')
    mockHistoryStore.push(historyRow({ id: 'h-promo', priceId, recordedAt, changeType: 'update', isAnnounced: true }))
    mockFindOne.mockResolvedValue(makePrice() as never)
    const { service, resolveOmnibusBlock } = makeService()

    await applyOmnibusSnapshotToLine({
      em,
      service,
      line: {},
      sourceLine: { productId, productVariantId: variantId, priceId },
      document,
      documentKind: 'order',
    })

    const [, context, presentedEntry, isPromotion] = resolveOmnibusBlock.mock.calls[0]
    expect(presentedEntry).toMatchObject({ priceId, changeType: 'update', recordedAt, isAnnounced: true })
    expect(isPromotion).toBe(true)
    expect(context).toMatchObject({
      tenantId,
      organizationId,
      productId,
      variantId,
      offerId: null,
      channelId,
      priceKindId,
      currencyCode: 'PLN',
      isStorefront: false,
    })
  })

  it('falls back to the price channel when the document has none', async () => {
    mockFindOne.mockResolvedValue(makePrice({ channelId }) as never)
    const { service, resolveOmnibusBlock } = makeService()

    await applyOmnibusSnapshotToLine({
      em,
      service,
      line: {},
      sourceLine: { productId, priceId },
      document: { ...document, channelId: null },
      documentKind: 'quote',
    })

    expect(resolveOmnibusBlock.mock.calls[0][1]).toMatchObject({ channelId })
  })

  it('scopes the price lookup to the document tenant and organization', async () => {
    mockFindOne.mockResolvedValue(makePrice() as never)
    const { service } = makeService()

    await applyOmnibusSnapshotToLine({
      em,
      service,
      line: {},
      sourceLine: { productId, priceId },
      document,
      documentKind: 'order',
    })

    expect(mockFindOne).toHaveBeenCalledWith(
      em,
      expect.anything(),
      { id: priceId, tenantId, organizationId },
      { populate: ['priceKind'] },
      { tenantId, organizationId },
    )
  })

  it('leaves the line untouched when the source line has no price reference', async () => {
    const { service, resolveOmnibusBlock } = makeService()
    const line: OmnibusSnapshotTarget = {}

    await applyOmnibusSnapshotToLine({
      em,
      service,
      line,
      sourceLine: { productId },
      document,
      documentKind: 'order',
    })

    expect(line).toEqual({})
    expect(mockFindOne).not.toHaveBeenCalled()
    expect(resolveOmnibusBlock).not.toHaveBeenCalled()
  })

  it('leaves the line untouched when the price is not visible in this scope', async () => {
    mockFindOne.mockResolvedValue(null as never)
    const { service, resolveOmnibusBlock } = makeService()
    const line: OmnibusSnapshotTarget = {}

    await applyOmnibusSnapshotToLine({ em, service, line, sourceLine: { productId, priceId }, document, documentKind: 'order' })

    expect(line).toEqual({})
    expect(resolveOmnibusBlock).not.toHaveBeenCalled()
  })

  it('leaves the line untouched when Omnibus is disabled for the tenant', async () => {
    mockFindOne.mockResolvedValue(makePrice() as never)
    const { service } = makeService(jest.fn(async () => null))
    const line: OmnibusSnapshotTarget = {}

    await applyOmnibusSnapshotToLine({ em, service, line, sourceLine: { productId, priceId }, document, documentKind: 'order' })

    expect(line).toEqual({})
  })

  it('records a public price as not personalized and a null anchor when not promotion-anchored', async () => {
    mockFindOne.mockResolvedValue(makePrice() as never)
    const { service } = makeService(jest.fn(async () => ({ ...block, promotionAnchorAt: null })))
    const line: OmnibusSnapshotTarget = {}

    await applyOmnibusSnapshotToLine({ em, service, line, sourceLine: { productId, priceId }, document, documentKind: 'order' })

    expect(line.isPersonalized).toBe(false)
    expect(line.personalizationReason).toBeNull()
    expect(line.omnibusPromotionAnchorAt).toBeNull()
    expect(line.omnibusReferenceGross).toBe('100.0000')
  })

  it('swallows a resolver failure instead of aborting the document write', async () => {
    mockFindOne.mockResolvedValue(makePrice() as never)
    const { service } = makeService(
      jest.fn(async () => {
        throw new Error('history unavailable')
      }),
    )
    const line: OmnibusSnapshotTarget = {}

    await expect(
      applyOmnibusSnapshotToLine({ em, service, line, sourceLine: { productId, priceId }, document, documentKind: 'order' }),
    ).resolves.toBeUndefined()
    expect(line).toEqual({})
  })

  it('swallows a price-lookup failure', async () => {
    mockFindOne.mockRejectedValue(new Error('db down'))
    const { service } = makeService()

    await expect(
      applyOmnibusSnapshotToLine({ em, service, line: {}, sourceLine: { productId, priceId }, document, documentKind: 'quote' }),
    ).resolves.toBeUndefined()
  })

  it('overwrites whatever it is given, which is why callers capture only for new lines', async () => {
    mockFindOne.mockResolvedValue(makePrice() as never)
    const { service } = makeService(
      jest.fn(async () => ({ ...block, lowestPriceGross: '55.0000', applicabilityReason: 'insufficient_history' as const })),
    )
    const alreadyCaptured: OmnibusSnapshotTarget = {
      omnibusReferenceGross: '100.0000',
      omnibusApplicabilityReason: 'announced_promotion',
    }

    await applyOmnibusSnapshotToLine({
      em,
      service,
      line: alreadyCaptured,
      sourceLine: { productId, priceId },
      document,
      documentKind: 'order',
    })

    expect(alreadyCaptured.omnibusReferenceGross).toBe('55.0000')
    expect(alreadyCaptured.omnibusApplicabilityReason).toBe('insufficient_history')
  })
})

describe('applyOmnibusSnapshotToLine driven by the real CatalogOmnibusService', () => {
  const promoAt = new Date('2026-06-01T00:00:00.000Z')

  function makeRealService(config: Record<string, unknown>) {
    const moduleConfigService = { getValue: jest.fn().mockResolvedValue(config) } as unknown as ModuleConfigService
    return new DefaultCatalogOmnibusService(moduleConfigService, null)
  }

  const enabledConfig = {
    enabled: true,
    enabledCountryCodes: ['PL'],
    lookbackDays: 30,
    minimizationAxis: 'gross',
    channels: { [channelId]: { presentedPriceKindId: priceKindId, countryCode: 'PL' } },
  }

  beforeEach(() => {
    mockHistoryStore.push(
      historyRow({
        id: 'h-base',
        recordedAt: new Date('2026-04-20T00:00:00.000Z'),
        changeType: 'create',
        unitPriceNet: '81.3008',
        unitPriceGross: '100.0000',
      }),
      historyRow({
        id: 'h-gone',
        recordedAt: new Date('2026-05-20T00:00:00.000Z'),
        changeType: 'delete',
        unitPriceNet: '8.1300',
        unitPriceGross: '10.0000',
      }),
      historyRow({
        id: 'h-promo',
        priceId,
        recordedAt: promoAt,
        startsAt: promoAt,
        changeType: 'update',
        unitPriceNet: '65.0407',
        unitPriceGross: '80.0000',
        isAnnounced: true,
      }),
    )
  })

  it('writes the reference the real resolver produced', async () => {
    mockFindOne.mockResolvedValue(makePrice({ startsAt: promoAt, customerGroupId: 'grp-1' }) as never)
    const line: OmnibusSnapshotTarget = {}

    await applyOmnibusSnapshotToLine({
      em,
      service: makeRealService(enabledConfig),
      line,
      sourceLine: { productId, priceId, currencyCode: 'PLN' },
      document,
      documentKind: 'order',
    })

    expect(line.omnibusReferenceGross).toBe('100.0000')
    expect(line.omnibusReferenceNet).toBe('81.3008')
    expect(line.omnibusApplicabilityReason).toBe('announced_promotion')
    expect(line.omnibusPromotionAnchorAt).toEqual(promoAt)
    expect(line.isPersonalized).toBe(true)
    expect(line.personalizationReason).toBe('customer_group_price')
  })

  it('records nothing when the tenant has Omnibus disabled', async () => {
    mockFindOne.mockResolvedValue(makePrice() as never)
    const line: OmnibusSnapshotTarget = {}

    await applyOmnibusSnapshotToLine({
      em,
      service: makeRealService({ enabled: false }),
      line,
      sourceLine: { productId, priceId },
      document,
      documentKind: 'order',
    })

    expect(line).toEqual({})
  })
})
