/**
 * Step 3.10 — prices / price_kinds / offers unit tests.
 *
 * Phase 3b of `2026-04-27-ai-tools-api-backed-dry-refactor`:
 * `catalog.list_prices` and `catalog.list_offers` delegate to the in-process
 * API operation runner over `GET /api/catalog/prices` and
 * `GET /api/catalog/offers`. The price-kinds tool keeps the ORM path.
 */
const findWithDecryptionMock = jest.fn()
const runMock = jest.fn()
const createRunnerMock = jest.fn(() => ({ run: runMock }))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(),
}))

jest.mock(
  '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner',
  () => {
    const actual = jest.requireActual(
      '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner',
    )
    return {
      ...actual,
      createAiApiOperationRunner: (...args: unknown[]) => createRunnerMock(...args),
    }
  },
)

import pricesOffersAiTools from '../../ai-tools/prices-offers-pack'
import { knownFeatureIds, makeCtx } from './shared'

function findTool(name: string) {
  const tool = pricesOffersAiTools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`tool ${name} missing`)
  return tool
}

describe('catalog.list_prices', () => {
  const tool = findTool('catalog.list_prices')

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    runMock.mockReset()
    createRunnerMock.mockClear()
  })

  it('declares a RBAC view feature that exists in acl.ts', () => {
    expect(tool.requiredFeatures).toBeDefined()
    for (const feature of tool.requiredFeatures!) {
      expect(knownFeatureIds.has(feature)).toBe(true)
    }
    expect(tool.isMutation).toBeFalsy()
  })

  it('caps limit at 100 via input schema', () => {
    expect(tool.inputSchema.safeParse({ limit: 150 }).success).toBe(false)
  })

  it('delegates to the API runner with default page/pageSize and maps the response', async () => {
    runMock.mockResolvedValue({
      success: true,
      statusCode: 200,
      data: {
        items: [
          {
            id: 'pr-1',
            tenant_id: 'tenant-1',
            organization_id: 'org-1',
            currency_code: 'EUR',
            kind: 'regular',
            min_quantity: 1,
            unit_price_net: '9.99',
            channel_id: null,
            starts_at: '2024-01-01T00:00:00.000Z',
            created_at: '2024-01-02T00:00:00.000Z',
          },
        ],
        total: 1,
      },
    })
    const ctx = makeCtx()
    const result = (await tool.handler({}, ctx as any)) as Record<string, unknown>
    const items = result.items as Array<Record<string, unknown>>
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('pr-1')
    expect(items[0].currencyCode).toBe('EUR')
    expect(items[0].kind).toBe('regular')
    expect(items[0].minQuantity).toBe(1)
    expect(items[0].unitPriceNet).toBe('9.99')
    expect(items[0].tenantId).toBe('tenant-1')
    expect(result.total).toBe(1)
    expect(result.limit).toBe(50)
    expect(result.offset).toBe(0)

    expect(runMock).toHaveBeenCalledTimes(1)
    const operation = runMock.mock.calls[0][0]
    expect(operation.method).toBe('GET')
    expect(operation.path).toBe('/catalog/prices')
    expect(operation.query).toMatchObject({ page: 1, pageSize: 50 })
  })

  it('passes productId / variantId / priceKindId filters through to the query', async () => {
    runMock.mockResolvedValue({ success: true, statusCode: 200, data: { items: [], total: 0 } })
    const ctx = makeCtx()
    await tool.handler(
      {
        productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        variantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        priceKindId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      },
      ctx as any,
    )
    const operation = runMock.mock.calls[0][0]
    expect(operation.query.productId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    expect(operation.query.variantId).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    expect(operation.query.priceKindId).toBe('cccccccc-cccc-4ccc-8ccc-cccccccccccc')
  })

  it('translates limit/offset into page/pageSize', async () => {
    runMock.mockResolvedValue({ success: true, statusCode: 200, data: { items: [], total: 0 } })
    const ctx = makeCtx()
    await tool.handler({ limit: 10, offset: 30 }, ctx as any)
    const operation = runMock.mock.calls[0][0]
    expect(operation.query.pageSize).toBe(10)
    // offset 30 with limit 10 → page 4
    expect(operation.query.page).toBe(4)
  })

  it('rejects calls without a tenant context', async () => {
    const ctx = makeCtx({ tenantId: null })
    await expect(tool.handler({}, ctx as any)).rejects.toThrow(/Tenant context is required/)
  })

  it('bubbles a clean Error when the runner reports failure', async () => {
    runMock.mockResolvedValue({ success: false, statusCode: 403, error: 'forbidden by route policy' })
    const ctx = makeCtx()
    await expect(tool.handler({}, ctx as any)).rejects.toThrow('forbidden by route policy')
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
    runMock.mockReset()
    createRunnerMock.mockClear()
  })

  it('declares a RBAC view feature that exists in acl.ts', () => {
    expect(tool.requiredFeatures).toBeDefined()
    for (const feature of tool.requiredFeatures!) {
      expect(knownFeatureIds.has(feature)).toBe(true)
    }
    expect(tool.isMutation).toBeFalsy()
  })

  it('caps limit at 100', () => {
    expect(tool.inputSchema.safeParse({ limit: 200 }).success).toBe(false)
  })

  it('delegates to the API runner without variantId pre-resolution when omitted', async () => {
    runMock.mockResolvedValue({
      success: true,
      statusCode: 200,
      data: {
        items: [
          {
            id: 'o1',
            tenant_id: 'tenant-1',
            organization_id: 'org-1',
            channel_id: 'ch-1',
            product_id: 'p1',
            title: 'Spring sale',
            is_active: true,
            created_at: '2024-01-01T00:00:00.000Z',
          },
        ],
        total: 1,
      },
    })
    const ctx = makeCtx()
    const result = (await tool.handler({ active: true }, ctx as any)) as Record<string, unknown>
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
    expect(runMock).toHaveBeenCalledTimes(1)
    const operation = runMock.mock.calls[0][0]
    expect(operation.method).toBe('GET')
    expect(operation.path).toBe('/catalog/offers')
    expect(operation.query).toMatchObject({ page: 1, pageSize: 50, isActive: 'true' })
    expect(operation.query.id).toBeUndefined()
    const items = result.items as Array<Record<string, unknown>>
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Spring sale')
    expect(items[0].channelId).toBe('ch-1')
    expect(items[0].productId).toBe('p1')
    expect(items[0].isActive).toBe(true)
    expect(result.total).toBe(1)
  })

  it('feeds nil uuid as id when variantId yields no offer ids (route returns empty)', async () => {
    findWithDecryptionMock.mockResolvedValue([])
    runMock.mockResolvedValue({ success: true, statusCode: 200, data: { items: [], total: 0 } })
    const ctx = makeCtx()
    const result = (await tool.handler(
      { variantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      ctx as any,
    )) as Record<string, unknown>
    // Two findWithDecryption calls (toOperation + mapResponse re-resolve).
    expect(findWithDecryptionMock).toHaveBeenCalled()
    const operation = runMock.mock.calls[0][0]
    expect(operation.query.id).toBe('00000000-0000-0000-0000-000000000000')
    expect((result.items as unknown[]).length).toBe(0)
    expect(result.total).toBe(0)
  })

  it('uses the single offer id when variantId resolves to exactly one', async () => {
    findWithDecryptionMock.mockResolvedValue([
      { offer: { id: 'o1' } },
      { offer: 'o1' },
    ])
    runMock.mockResolvedValue({
      success: true,
      statusCode: 200,
      data: {
        items: [
          { id: 'o1', tenant_id: 'tenant-1', title: 'Spring sale', channel_id: 'ch-1', product_id: 'p1', is_active: true, created_at: '2024-01-01T00:00:00.000Z' },
        ],
        total: 1,
      },
    })
    const ctx = makeCtx()
    const result = (await tool.handler(
      { variantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      ctx as any,
    )) as Record<string, unknown>
    const operation = runMock.mock.calls[0][0]
    expect(operation.query.id).toBe('o1')
    expect((result.items as Array<Record<string, unknown>>)[0].id).toBe('o1')
    expect(result.total).toBe(1)
  })

  it('post-filters response by resolved offer ids when variantId resolves to multiple offers', async () => {
    findWithDecryptionMock.mockResolvedValue([
      { offer: { id: 'o1' } },
      { offer: { id: 'o2' } },
    ])
    runMock.mockResolvedValue({
      success: true,
      statusCode: 200,
      data: {
        items: [
          { id: 'o1', tenant_id: 'tenant-1', title: 'A', channel_id: 'ch-1', product_id: 'p1', is_active: true, created_at: '2024-01-01T00:00:00.000Z' },
          { id: 'o2', tenant_id: 'tenant-1', title: 'B', channel_id: 'ch-1', product_id: 'p1', is_active: true, created_at: '2024-01-02T00:00:00.000Z' },
          { id: 'o3', tenant_id: 'tenant-1', title: 'Other', channel_id: 'ch-2', product_id: 'p1', is_active: true, created_at: '2024-01-03T00:00:00.000Z' },
        ],
        total: 3,
      },
    })
    const ctx = makeCtx()
    const result = (await tool.handler(
      { variantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      ctx as any,
    )) as Record<string, unknown>
    const operation = runMock.mock.calls[0][0]
    expect(operation.query.id).toBeUndefined()
    const items = result.items as Array<Record<string, unknown>>
    expect(items.map((row) => row.id)).toEqual(['o1', 'o2'])
    expect(result.total).toBe(2)
  })

  it('rejects calls without a tenant context', async () => {
    const ctx = makeCtx({ tenantId: null })
    await expect(tool.handler({}, ctx as any)).rejects.toThrow(/Tenant context is required/)
  })

  it('bubbles a clean Error when the runner reports failure', async () => {
    runMock.mockResolvedValue({ success: false, statusCode: 403, error: 'forbidden by route policy' })
    const ctx = makeCtx()
    await expect(tool.handler({}, ctx as any)).rejects.toThrow('forbidden by route policy')
  })
})
