import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { CatalogProductPrice } from '../../data/entities'
import { buildOmnibusBlock } from '../../services/catalogOmnibusService'
import { omnibusConfigSchema, type OmnibusBlock } from '../../lib/omnibusTypes'

type ListConfig = { hooks: { afterList: (payload: { items: Array<{ id: string; omnibus?: OmnibusBlock }> }, ctx: CrudCtx) => Promise<void> } }
const makeCrudRouteMock = jest.fn((_config: ListConfig) => ({ metadata: {}, GET: jest.fn() }))
const findMock = jest.fn()

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: (config: ListConfig) => makeCrudRouteMock(config),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findMock(...args),
}))
jest.mock('../../lib/omnibusPresentedEntry', () => ({
  ...jest.requireActual('../../lib/omnibusPresentedEntry'),
  resolveOmnibusPresentedEntries: async () => new Map(),
}))

it('serializes all four existing products API reference fields as fixed4 without rounding internal references', async () => {
  await import('../products/route')
  const afterList = makeCrudRouteMock.mock.calls[0][0].hooks.afterList
  const priceKindId = '33333333-3333-4333-8333-333333333333'
  const price = {
    id: 'price-1', product: 'product-1', tenantId: 'tenant-1', organizationId: 'org-1',
    currencyCode: 'PLN', kind: 'regular', minQuantity: 1, unitPriceNet: '80', unitPriceGross: '80',
    priceKind: { id: priceKindId, code: 'regular', isPromotion: true },
  }
  const row = {
    id: 'history-1', priceId: price.id, changeType: 'update' as const,
    recordedAt: '2026-05-01T00:00:00.000Z',
    unitPriceNet: '100000000000000.1234567890123456789', unitPriceGross: '123.1234567890123456789',
  }
  const exact = buildOmnibusBlock({
    reason: null, presentedPriceKindId: priceKindId, lowestRow: row,
    previousRow: { ...row, unitPriceNet: '99.9999999999999999999', unitPriceGross: '150.00004' },
    insufficientHistory: false, promotionAnchorAt: null, coverageStartAt: null,
    windowStart: null, windowEnd: null, lookbackDays: 30, minimizationAxis: 'gross',
  }, { tenantId: 'tenant-1', organizationId: 'org-1', currencyCode: 'PLN' }, null, true)
  const service = {
    getConfig: async () => omnibusConfigSchema.parse({ enabled: true }),
    resolvePresentedPriceKindId: () => priceKindId,
    resolveOmnibusBlocks: jest.fn(async () => [exact]),
  }
  const em = { fork: () => em }
  findMock.mockImplementation(async (_em: unknown, entity: unknown) => entity === CatalogProductPrice ? [price] : [])
  const ctx = {
    container: { resolve: (key: string) => {
      if (key === 'em') return em
      if (key === 'catalogPricingService') return { resolvePriceMany: async () => [price] }
      if (key === 'catalogOmnibusService') return service
      throw new Error(`[internal] unexpected resolve ${key}`)
    } },
    auth: { tenantId: 'tenant-1', orgId: 'org-1' }, selectedOrganizationId: 'org-1',
    organizationIds: ['org-1'], query: {},
  } as unknown as CrudCtx
  const payload: { items: Array<{ id: string; omnibus?: OmnibusBlock }> } = { items: [{ id: 'product-1' }] }
  await afterList(payload, ctx)
  expect(payload.items[0].omnibus).toEqual({
    ...exact, lowestPriceNet: '100000000000000.1235', lowestPriceGross: '123.1235',
    previousPriceNet: '100.0000', previousPriceGross: '150.0000',
  })
  expect(exact.lowestPriceNet).toBe(row.unitPriceNet)
  expect(exact.lowestPriceGross).toBe(row.unitPriceGross)
  expect(service.resolveOmnibusBlocks).toHaveBeenCalledTimes(1)
})
