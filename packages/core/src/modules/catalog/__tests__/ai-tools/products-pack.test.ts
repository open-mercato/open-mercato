/**
 * Step 3.10 — `catalog.list_products` / `catalog.get_product` unit tests.
 */
const findWithDecryptionMock = jest.fn()
const findOneWithDecryptionMock = jest.fn()
const loadCustomFieldValuesMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: (...args: unknown[]) => loadCustomFieldValuesMock(...args),
}))

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
  })

  it('declares a RBAC view feature that exists in acl.ts', () => {
    expect(tool.requiredFeatures).toBeDefined()
    for (const feature of tool.requiredFeatures!) {
      expect(knownFeatureIds.has(feature)).toBe(true)
    }
    expect(tool.isMutation).toBeFalsy()
  })

  it('filters rows to the caller tenant and drops cross-tenant data', async () => {
    findWithDecryptionMock.mockResolvedValue([
      { id: 'p1', tenantId: 'tenant-1', organizationId: 'org-1', title: 'Alpha', productType: 'simple', createdAt: new Date('2024-01-01'), updatedAt: new Date('2024-01-01') },
      { id: 'p2', tenantId: 'tenant-2', organizationId: 'org-1', title: 'Leak', productType: 'simple', createdAt: new Date('2024-01-02'), updatedAt: new Date('2024-01-02') },
    ])
    const ctx = makeCtx()
    ctx.em.count.mockResolvedValue(2)
    const result = (await tool.handler({}, ctx as any)) as Record<string, unknown>
    const items = result.items as Array<Record<string, unknown>>
    expect(items.map((entry) => entry.id)).toEqual(['p1'])
    const whereArg = findWithDecryptionMock.mock.calls[0][2]
    expect(whereArg.tenantId).toBe('tenant-1')
    expect(whereArg.organizationId).toBe('org-1')
    expect(whereArg.deletedAt).toBeNull()
  })

  it('rejects calls without a tenant context', async () => {
    const ctx = makeCtx({ tenantId: null })
    await expect(tool.handler({}, ctx as any)).rejects.toThrow(/Tenant context is required/)
  })

  it('caps limit at 100 via input schema', () => {
    const parsed = tool.inputSchema.safeParse({ limit: 150 })
    expect(parsed.success).toBe(false)
  })

  it('returns empty short-circuit when categoryId yields no assignments', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([])
    const ctx = makeCtx()
    const categoryId = '11111111-1111-4111-8111-111111111111'
    const result = (await tool.handler({ categoryId }, ctx as any)) as Record<string, unknown>
    expect(result).toEqual({ items: [], total: 0, limit: 50, offset: 0 })
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
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
