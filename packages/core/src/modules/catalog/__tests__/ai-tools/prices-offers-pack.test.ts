/**
 * Step 3.10 — prices / price_kinds / offers unit tests.
 */
const findWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(),
}))

import pricesOffersAiTools from '../../ai-tools/prices-offers-pack'
import { makeCtx } from './shared'

function findTool(name: string) {
  const tool = pricesOffersAiTools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`tool ${name} missing`)
  return tool
}

describe('catalog.list_prices', () => {
  const tool = findTool('catalog.list_prices')

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
  })

  it('drops cross-tenant rows', async () => {
    findWithDecryptionMock.mockResolvedValue([
      { id: 'pr-1', tenantId: 'tenant-1', organizationId: 'org-1', currencyCode: 'EUR', kind: 'regular', minQuantity: 1 },
      { id: 'pr-2', tenantId: 'tenant-2', organizationId: 'org-1', currencyCode: 'USD', kind: 'regular', minQuantity: 1 },
    ])
    const ctx = makeCtx()
    ctx.em.count.mockResolvedValue(2)
    const result = (await tool.handler({}, ctx as any)) as Record<string, unknown>
    const ids = (result.items as any[]).map((r) => r.id)
    expect(ids).toEqual(['pr-1'])
    const whereArg = findWithDecryptionMock.mock.calls[0][2]
    expect(whereArg.tenantId).toBe('tenant-1')
    expect(whereArg.organizationId).toBe('org-1')
  })

  it('passes productId / variantId / priceKindId filters through to where', async () => {
    findWithDecryptionMock.mockResolvedValue([])
    const ctx = makeCtx()
    ctx.em.count.mockResolvedValue(0)
    await tool.handler(
      {
        productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        variantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        priceKindId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      },
      ctx as any,
    )
    const whereArg = findWithDecryptionMock.mock.calls[0][2]
    expect(whereArg.product).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    expect(whereArg.variant).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    expect(whereArg.priceKind).toBe('cccccccc-cccc-4ccc-8ccc-cccccccccccc')
  })
})

describe('catalog.list_price_kinds_base', () => {
  const tool = findTool('catalog.list_price_kinds_base')

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
  })

  it('returns tenant-scoped rows (drops cross-tenant leaks)', async () => {
    findWithDecryptionMock.mockResolvedValue([
      { id: 'pk-1', tenantId: 'tenant-1', code: 'regular', title: 'Regular', displayMode: 'excluding-tax', isPromotion: false, isActive: true },
      { id: 'pk-2', tenantId: 'tenant-2', code: 'promo', title: 'Promo', displayMode: 'including-tax', isPromotion: true, isActive: true },
    ])
    const ctx = makeCtx()
    ctx.em.count.mockResolvedValue(2)
    const result = (await tool.handler({}, ctx as any)) as Record<string, unknown>
    const codes = (result.items as any[]).map((r) => r.code)
    expect(codes).toEqual(['regular'])
  })

  it('gates on catalog.settings.manage (price kinds are settings-scoped)', () => {
    expect(tool.requiredFeatures).toContain('catalog.settings.manage')
  })
})

describe('catalog.list_offers', () => {
  const tool = findTool('catalog.list_offers')

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
  })

  it('caps limit at 100', () => {
    expect(tool.inputSchema.safeParse({ limit: 200 }).success).toBe(false)
  })

  it('returns { items: [], total: 0 } when variantId yields no prices (no offers query)', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([])
    const ctx = makeCtx()
    const result = (await tool.handler(
      { variantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      ctx as any,
    )) as Record<string, unknown>
    expect(result).toEqual({ items: [], total: 0, limit: 50, offset: 0 })
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
  })
})
