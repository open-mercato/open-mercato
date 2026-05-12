/**
 * Step 3.10 — `catalog.list_products` / `catalog.get_product` unit tests.
 *
 * Phase 3b of `2026-04-27-ai-tools-api-backed-dry-refactor`: the list tool
 * delegates to the in-process API operation runner over
 * `GET /api/catalog/products`. Tests mock the runner module rather than the
 * ORM/query engine.
 */
const findWithDecryptionMock = jest.fn()
const findOneWithDecryptionMock = jest.fn()
const loadCustomFieldValuesMock = jest.fn()
const runMock = jest.fn()
const createRunnerMock = jest.fn(() => ({ run: runMock }))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: (...args: unknown[]) => loadCustomFieldValuesMock(...args),
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

import productsAiTools from '../../ai-tools/products-pack'
import { knownFeatureIds, makeCtx } from './shared'

function findTool(name: string) {
  const tool = productsAiTools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`tool ${name} missing`)
  return tool
}

describe('catalog.list_products', () => {
  const tool = findTool('catalog.list_products')

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    findOneWithDecryptionMock.mockReset()
    loadCustomFieldValuesMock.mockReset()
    runMock.mockReset()
    createRunnerMock.mockClear()
  })

  it('declares a RBAC view feature that exists in acl.ts', () => {
    expect(tool.requiredFeatures).toBeDefined()
    expect(tool.requiredFeatures!.length).toBeGreaterThan(0)
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
            id: 'p1',
            title: 'Alpha',
            sku: 'A-1',
            product_type: 'simple',
            tenant_id: 'tenant-1',
            organization_id: 'org-1',
            is_active: true,
            is_configurable: false,
            created_at: '2024-01-01T00:00:00.000Z',
            updated_at: '2024-01-02T00:00:00.000Z',
          },
        ],
        total: 1,
      },
    })
    const ctx = makeCtx()
    const result = (await tool.handler({}, ctx as any)) as Record<string, unknown>
    const items = result.items as Array<Record<string, unknown>>
    expect(items.map((entry) => entry.id)).toEqual(['p1'])
    expect(items[0].title).toBe('Alpha')
    expect(items[0].sku).toBe('A-1')
    expect(items[0].productType).toBe('simple')
    expect(items[0].isActive).toBe(true)
    expect(items[0].tenantId).toBe('tenant-1')
    expect(result.limit).toBe(50)
    expect(result.offset).toBe(0)
    expect(result.total).toBe(1)

    expect(runMock).toHaveBeenCalledTimes(1)
    const operation = runMock.mock.calls[0][0]
    expect(operation.method).toBe('GET')
    expect(operation.path).toBe('/catalog/products')
    expect(operation.query).toMatchObject({ page: 1, pageSize: 50 })
    expect(operation.query.search).toBeUndefined()
  })

  it('translates q/limit/offset/categoryId/tagIds/active inputs to API query params', async () => {
    runMock.mockResolvedValue({ success: true, statusCode: 200, data: { items: [], total: 0 } })
    const ctx = makeCtx()
    const categoryId = '11111111-1111-4111-8111-111111111111'
    const tagId1 = '22222222-2222-4222-8222-222222222222'
    const tagId2 = '33333333-3333-4333-8333-333333333333'
    await tool.handler(
      {
        q: '  widget  ',
        limit: 25,
        offset: 50,
        categoryId,
        tagIds: [tagId1, tagId2],
        active: true,
      },
      ctx as any,
    )
    const operation = runMock.mock.calls[0][0]
    expect(operation.query.search).toBe('widget')
    expect(operation.query.pageSize).toBe(25)
    // offset 50 with limit 25 → page 3
    expect(operation.query.page).toBe(3)
    expect(operation.query.categoryIds).toBe(categoryId)
    expect(operation.query.tagIds).toBe(`${tagId1},${tagId2}`)
    expect(operation.query.isActive).toBe('true')
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

describe('catalog.get_product', () => {
  const tool = findTool('catalog.get_product')

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    findOneWithDecryptionMock.mockReset()
    loadCustomFieldValuesMock.mockReset()
    loadCustomFieldValuesMock.mockResolvedValue({})
  })

  const missingId = '0e4a4e66-2894-4f6c-96bb-fdfa32a9177b'
  const existingId = 'ba9d7593-367c-4a93-9918-c998ff3e5a1d'

  it('returns { found: false } for missing records (no throw)', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)
    const ctx = makeCtx()
    const result = (await tool.handler({ productId: missingId }, ctx as any)) as Record<string, unknown>
    expect(result.found).toBe(false)
    expect(result.productId).toBe(missingId)
  })

  it('returns found=false when entity tenant mismatches ctx.tenantId', async () => {
    findOneWithDecryptionMock.mockResolvedValue({
      id: existingId,
      tenantId: 'tenant-2',
      organizationId: 'org-1',
      title: 'Leak',
      productType: 'simple',
    })
    const ctx = makeCtx()
    const result = (await tool.handler({ productId: existingId }, ctx as any)) as Record<string, unknown>
    expect(result.found).toBe(false)
  })

  it('minimal product fetch (no includeRelated) returns product + null related', async () => {
    findOneWithDecryptionMock.mockResolvedValue({
      id: existingId,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      title: 'Blue Widget',
      productType: 'simple',
      isActive: true,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-02'),
    })
    const ctx = makeCtx()
    const result = (await tool.handler({ productId: existingId }, ctx as any)) as Record<string, unknown>
    expect(result.found).toBe(true)
    const product = result.product as Record<string, unknown>
    expect(product.title).toBe('Blue Widget')
    expect(result.related).toBeNull()
    expect(result.customFields).toEqual({})
    expect(loadCustomFieldValuesMock).not.toHaveBeenCalled()
  })

  it('includeRelated: true hydrates categories/tags/variants/prices/media/unitConversions/customFields', async () => {
    findOneWithDecryptionMock.mockResolvedValue({
      id: existingId,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      title: 'Blue Widget',
      productType: 'simple',
      isActive: true,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-02'),
    })
    findWithDecryptionMock
      .mockResolvedValueOnce([{ category: { id: 'cat-1', name: 'Root', slug: 'root' }, tenantId: 'tenant-1' }])
      .mockResolvedValueOnce([{ tag: { id: 'tag-1', label: 'Hot', slug: 'hot' }, tenantId: 'tenant-1' }])
      .mockResolvedValueOnce([{ id: 'var-1', tenantId: 'tenant-1', name: 'Default', sku: 'SKU-1', isActive: true, isDefault: true }])
      .mockResolvedValueOnce([{ id: 'pr-1', tenantId: 'tenant-1', currencyCode: 'EUR', kind: 'regular', minQuantity: 1 }])
      .mockResolvedValueOnce([{ id: 'att-1', tenantId: 'tenant-1', fileName: 'a.jpg', mimeType: 'image/jpeg', fileSize: 100, url: '/a' }])
      .mockResolvedValueOnce([{ id: 'uc-1', tenantId: 'tenant-1', unitCode: 'kg', toBaseFactor: '1', sortOrder: 0, isActive: true }])
    loadCustomFieldValuesMock.mockResolvedValue({ [existingId]: { note: 'vip' } })
    const ctx = makeCtx()
    const result = (await tool.handler({ productId: existingId, includeRelated: true }, ctx as any)) as Record<string, unknown>
    expect(result.found).toBe(true)
    const related = result.related as Record<string, unknown>
    expect(Object.keys(related).sort()).toEqual(
      ['categories', 'customFields', 'media', 'prices', 'tags', 'unitConversions', 'variants'].sort(),
    )
    expect((related.categories as any[])[0].id).toBe('cat-1')
    expect((related.tags as any[])[0].label).toBe('Hot')
    expect((related.variants as any[])[0].sku).toBe('SKU-1')
    expect((related.prices as any[])[0].currencyCode).toBe('EUR')
    expect((related.media as any[])[0].fileName).toBe('a.jpg')
    expect((related.unitConversions as any[])[0].unitCode).toBe('kg')
    expect(result.customFields).toEqual({ note: 'vip' })
  })
})
