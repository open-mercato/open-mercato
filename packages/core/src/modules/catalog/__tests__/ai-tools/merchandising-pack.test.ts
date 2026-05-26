/**
 * Step 3.11 — D18 merchandising read tools unit tests.
 *
 * Covers the seven canonical tools the `catalog.merchandising_assistant`
 * agent will whitelist in Step 4.9:
 *
 * - `catalog.search_products`      (routing + tenant isolation)
 * - `catalog.get_product_bundle`   (not-found + aggregate shape)
 * - `catalog.list_selected_products` (dedup + missingIds cross-tenant)
 * - `catalog.get_product_media`    (attachmentId only, no bytes)
 * - `catalog.get_attribute_schema` (reuse shared resolver)
 * - `catalog.get_category_brief`   (not-found path)
 * - `catalog.list_price_kinds`     (D18 surface + coexistence with `_base`)
 */
const findWithDecryptionMock = jest.fn()
const findOneWithDecryptionMock = jest.fn()
const loadCustomFieldValuesMock = jest.fn()
const loadCustomFieldDefinitionIndexMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: (...args: unknown[]) => loadCustomFieldValuesMock(...args),
  loadCustomFieldDefinitionIndex: (...args: unknown[]) =>
    loadCustomFieldDefinitionIndexMock(...args),
}))

import merchandisingAiTools from '../../ai-tools/merchandising-pack'
import aiTools from '../../ai-tools'
import { knownFeatureIds, makeCtx } from './shared'

function findTool(name: string) {
  const tool = merchandisingAiTools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`tool ${name} missing`)
  return tool
}

function makeCtxWithSearch(overrides: {
  searchService?: { search: jest.Mock } | null
  pricingService?: { resolvePrice: jest.Mock } | null
} = {}) {
  const em: any = {
    count: jest.fn().mockResolvedValue(0),
    persist: jest.fn(function (this: any) {
      return em
    }),
    flush: jest.fn().mockResolvedValue(undefined),
  }
  const queryEngine = {
    query: jest.fn().mockResolvedValue({ items: [], total: 0 }),
  }
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return em
      if (name === 'queryEngine') return queryEngine
      if (name === 'searchService') {
        if (overrides.searchService === null) throw new Error('no searchService')
        return overrides.searchService ?? { search: jest.fn().mockResolvedValue([]) }
      }
      if (name === 'catalogPricingService') {
        if (overrides.pricingService === null) throw new Error('no pricingService')
        return overrides.pricingService ?? { resolvePrice: jest.fn().mockResolvedValue(null) }
      }
      throw new Error(`unexpected resolve: ${name}`)
    }),
  }
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    container: container as any,
    userFeatures: ['catalog.products.view', 'catalog.categories.view', 'catalog.settings.manage'],
    isSuperAdmin: false,
    em,
    queryEngine,
  }
}

beforeEach(() => {
  findWithDecryptionMock.mockReset()
  findOneWithDecryptionMock.mockReset()
  loadCustomFieldValuesMock.mockReset()
  loadCustomFieldValuesMock.mockResolvedValue({})
  loadCustomFieldDefinitionIndexMock.mockReset()
  loadCustomFieldDefinitionIndexMock.mockResolvedValue(new Map())
})

describe('merchandising pack — RBAC', () => {
  it('every tool declares a non-empty requiredFeatures that exists in acl.ts', () => {
    for (const tool of merchandisingAiTools) {
      expect(tool.requiredFeatures?.length ?? 0).toBeGreaterThan(0)
      for (const feature of tool.requiredFeatures!) {
        expect(knownFeatureIds.has(feature)).toBe(true)
      }
      expect(tool.isMutation).toBeFalsy()
    }
  })
})

describe('catalog.search_products', () => {
  const tool = findTool('catalog.search_products')

  it('routes to the search service when q is non-empty', async () => {
    const search = jest.fn().mockResolvedValue([
      { entityId: 'catalog:catalog_product', recordId: 'p1', score: 1, source: 'fulltext' },
    ])
    const ctx = makeCtxWithSearch({ searchService: { search } })
    // Post-PR #1593: the search path still hits the search service to
    // resolve record ids, then hydrates via queryEngine + findWithDecryption
    // scoped to the tenant.
    ctx.queryEngine.query.mockResolvedValue({ items: [{ id: 'p1' }], total: 1 })
    findWithDecryptionMock.mockResolvedValue([
      {
        id: 'p1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        title: 'Alpha',
        productType: 'simple',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      },
    ])
    const result = (await tool.handler({ q: 'alpha' }, ctx as any)) as Record<string, unknown>
    expect(search).toHaveBeenCalledWith('alpha', expect.objectContaining({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      entityTypes: ['catalog:catalog_product'],
    }))
    expect(result.source).toBe('search_service')
    const items = result.items as Array<Record<string, unknown>>
    expect(items.map((entry) => entry.id)).toEqual(['p1'])
  })

  it('routes to the query engine when q is empty', async () => {
    // Post-PR #1593: the query-engine path delegates to
    // queryEngine.query('catalog:catalog_product', ...) then hydrates via
    // findWithDecryption keyed by the returned id set.
    const search = jest.fn()
    const ctx = makeCtxWithSearch({ searchService: { search } })
    ctx.queryEngine.query.mockResolvedValue({ items: [{ id: 'p2' }], total: 1 })
    findWithDecryptionMock.mockResolvedValue([
      {
        id: 'p2',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        title: 'Beta',
        productType: 'simple',
        createdAt: new Date('2024-01-02'),
        updatedAt: new Date('2024-01-02'),
      },
    ])
    const result = (await tool.handler({}, ctx as any)) as Record<string, unknown>
    expect(search).not.toHaveBeenCalled()
    expect(ctx.queryEngine.query).toHaveBeenCalled()
    const [entityType, queryArg] = ctx.queryEngine.query.mock.calls[0]
    expect(entityType).toBe('catalog:catalog_product')
    expect(queryArg.tenantId).toBe('tenant-1')
    expect(queryArg.organizationId).toBe('org-1')
    expect(result.source).toBe('query_engine')
  })

  it('forwards tenantId to findWithDecryption so hydration is tenant-scoped', async () => {
    // Post-PR #1593: cross-tenant isolation on the query-engine path is
    // enforced at two layers (queryEngine.query scope + findWithDecryption
    // tenantId filter). The tool itself no longer filters in-process —
    // verify the tenantId is correctly threaded into findWithDecryption.
    const ctx = makeCtxWithSearch({ searchService: { search: jest.fn() } })
    ctx.queryEngine.query.mockResolvedValue({ items: [{ id: 'p1' }], total: 1 })
    findWithDecryptionMock.mockResolvedValue([
      { id: 'p1', tenantId: 'tenant-1', organizationId: 'org-1', title: 'Alpha', productType: 'simple', createdAt: new Date(), updatedAt: new Date() },
    ])
    const result = (await tool.handler({}, ctx as any)) as Record<string, unknown>
    const items = result.items as Array<Record<string, unknown>>
    expect(items.map((entry) => entry.id)).toEqual(['p1'])
    // findWithDecryption receives { tenantId, id: { $in: [...] }, deletedAt: null }
    const whereArg = findWithDecryptionMock.mock.calls[0][2]
    expect(whereArg.tenantId).toBe('tenant-1')
  })

  it('returns empty short-circuit when the search service yields zero hits', async () => {
    const search = jest.fn().mockResolvedValue([])
    const ctx = makeCtxWithSearch({ searchService: { search } })
    const result = (await tool.handler({ q: 'no-match' }, ctx as any)) as Record<string, unknown>
    expect(result).toEqual(expect.objectContaining({ total: 0, source: 'search_service', items: [] }))
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('caps limit at 100 via the input schema', () => {
    expect(tool.inputSchema.safeParse({ limit: 200 }).success).toBe(false)
  })
})

describe('catalog.get_product_bundle', () => {
  const tool = findTool('catalog.get_product_bundle')

  const missingId = '0e4a4e66-2894-4f6c-96bb-fdfa32a9177b'
  const existingId = 'ba9d7593-367c-4a93-9918-c998ff3e5a1d'

  it('returns { found: false } for missing records (no throw)', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)
    const ctx = makeCtxWithSearch()
    const result = (await tool.handler({ productId: missingId }, ctx as any)) as Record<string, unknown>
    expect(result.found).toBe(false)
    expect(result.productId).toBe(missingId)
  })

  it('returns { found: false } on cross-tenant id', async () => {
    findOneWithDecryptionMock.mockResolvedValue({
      id: existingId,
      tenantId: 'tenant-2',
      title: 'Leak',
      productType: 'simple',
    })
    const ctx = makeCtxWithSearch()
    const result = (await tool.handler({ productId: existingId }, ctx as any)) as Record<string, unknown>
    expect(result.found).toBe(false)
  })

  it('returns the full aggregate shape on hit (translations: null surfaced)', async () => {
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
    findWithDecryptionMock.mockResolvedValue([])
    const ctx = makeCtxWithSearch({
      searchService: null,
      pricingService: { resolvePrice: jest.fn().mockResolvedValue(null) },
    })
    const result = (await tool.handler({ productId: existingId }, ctx as any)) as Record<string, unknown>
    expect(result.found).toBe(true)
    expect(result.translations).toBeNull()
    expect(result.id).toBe(existingId)
    expect(result.attributeSchema).toEqual(expect.objectContaining({ fields: expect.any(Array) }))
    expect(result.prices).toEqual(expect.objectContaining({ all: [], best: null }))
  })
})

describe('catalog.list_selected_products', () => {
  const tool = findTool('catalog.list_selected_products')

  it('deduplicates input ids before resolving', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)
    const ctx = makeCtxWithSearch()
    const dupe = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    await tool.handler({ productIds: [dupe, dupe, dupe] }, ctx as any)
    expect(findOneWithDecryptionMock).toHaveBeenCalledTimes(1)
  })

  it('cross-tenant ids appear in missingIds (not as a 403)', async () => {
    const crossId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const okId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    findOneWithDecryptionMock.mockImplementation((_em: unknown, _entity: unknown, where: Record<string, unknown>) => {
      if (where.id === crossId) {
        return Promise.resolve({ id: crossId, tenantId: 'tenant-2', title: 'Leak', productType: 'simple' })
      }
      return Promise.resolve({
        id: okId,
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        title: 'OK',
        productType: 'simple',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    })
    findWithDecryptionMock.mockResolvedValue([])
    const ctx = makeCtxWithSearch({
      searchService: null,
      pricingService: { resolvePrice: jest.fn().mockResolvedValue(null) },
    })
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = (await tool.handler({ productIds: [crossId, okId] }, ctx as any)) as Record<string, unknown>
      const items = result.items as Array<Record<string, unknown>>
      const missingIds = result.missingIds as string[]
      expect(items.map((entry) => entry.id)).toEqual([okId])
      expect(missingIds).toEqual([crossId])
      expect(warnSpy).toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('enforces the 1..50 bounds on productIds', () => {
    expect(tool.inputSchema.safeParse({ productIds: [] }).success).toBe(false)
    const tooMany = Array.from({ length: 51 }, (_, idx) =>
      `00000000-0000-4000-8000-${(idx + 1).toString(16).padStart(12, '0')}`,
    )
    expect(tool.inputSchema.safeParse({ productIds: tooMany }).success).toBe(false)
  })
})

describe('catalog.get_product_media', () => {
  const tool = findTool('catalog.get_product_media')

  it('returns attachmentId strings only (no bytes, no signed url)', async () => {
    findWithDecryptionMock.mockResolvedValue([
      {
        id: 'att-1',
        tenantId: 'tenant-1',
        fileName: 'hero.jpg',
        mimeType: 'image/jpeg',
        fileSize: 1024,
      },
    ])
    const ctx = makeCtxWithSearch()
    ctx.em.count.mockResolvedValue(1)
    const productId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const result = (await tool.handler({ productId }, ctx as any)) as Record<string, unknown>
    const items = result.items as Array<Record<string, unknown>>
    expect(items).toHaveLength(1)
    const item = items[0] as Record<string, unknown>
    expect(item.attachmentId).toBe('att-1')
    expect(item.fileName).toBe('hero.jpg')
    expect('bytes' in item).toBe(false)
    expect('content' in item).toBe(false)
    expect('signedUrl' in item).toBe(false)
  })
})

describe('catalog.get_attribute_schema', () => {
  const tool = findTool('catalog.get_attribute_schema')

  it('calls the shared loadCustomFieldDefinitionIndex resolver', async () => {
    loadCustomFieldDefinitionIndexMock.mockResolvedValueOnce(new Map())
    const ctx = makeCtxWithSearch()
    const productId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const result = (await tool.handler({ productId }, ctx as any)) as Record<string, unknown>
    expect(loadCustomFieldDefinitionIndexMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual(expect.objectContaining({
      fields: expect.any(Array),
      resolvedFor: expect.objectContaining({ productId }),
    }))
  })

  it('returns resolvedFor: {} when both ids are absent', async () => {
    loadCustomFieldDefinitionIndexMock.mockResolvedValueOnce(new Map())
    const ctx = makeCtxWithSearch()
    const result = (await tool.handler({}, ctx as any)) as Record<string, unknown>
    expect(result.resolvedFor).toEqual({})
  })
})

describe('catalog.get_category_brief', () => {
  const tool = findTool('catalog.get_category_brief')

  it('returns { found: false } for missing ids', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)
    const ctx = makeCtxWithSearch()
    const missing = '0e4a4e66-2894-4f6c-96bb-fdfa32a9177b'
    const result = (await tool.handler({ categoryId: missing }, ctx as any)) as Record<string, unknown>
    expect(result.found).toBe(false)
    expect(result.categoryId).toBe(missing)
  })

  it('returns { found: true, attributeSchema } on hit', async () => {
    const categoryId = 'ba9d7593-367c-4a93-9918-c998ff3e5a1d'
    findOneWithDecryptionMock.mockResolvedValue({
      id: categoryId,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      name: 'Tools',
      treePath: '/tools',
      description: 'Power tools',
    })
    loadCustomFieldDefinitionIndexMock.mockResolvedValueOnce(new Map())
    const ctx = makeCtxWithSearch()
    const result = (await tool.handler({ categoryId }, ctx as any)) as Record<string, unknown>
    expect(result.found).toBe(true)
    expect(result.name).toBe('Tools')
    expect(result.path).toBe('/tools')
    expect(result.attributeSchema).toEqual(expect.objectContaining({
      resolvedFor: expect.objectContaining({ categoryId }),
    }))
  })
})

describe('catalog.list_price_kinds (D18)', () => {
  const tool = findTool('catalog.list_price_kinds')

  it('ships alongside catalog.list_price_kinds_base in the aggregator', () => {
    const names = new Set(aiTools.map((entry) => entry.name))
    expect(names.has('catalog.list_price_kinds')).toBe(true)
    expect(names.has('catalog.list_price_kinds_base')).toBe(true)
  })

  it('projects the D18 spec shape ({ id, code, name, scope, currency, appliesTo })', async () => {
    findWithDecryptionMock.mockResolvedValue([
      {
        id: 'pk-1',
        tenantId: 'tenant-1',
        organizationId: null,
        code: 'regular',
        title: 'Regular',
        displayMode: 'excluding-tax',
        currencyCode: 'EUR',
        isPromotion: false,
        isActive: true,
      },
      {
        id: 'pk-2',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        code: 'promo',
        title: 'Promo',
        displayMode: 'including-tax',
        currencyCode: 'USD',
        isPromotion: true,
        isActive: true,
      },
    ])
    const ctx = makeCtxWithSearch()
    ctx.em.count.mockResolvedValue(2)
    const result = (await tool.handler({}, ctx as any)) as Record<string, unknown>
    const items = result.items as Array<Record<string, unknown>>
    expect(items[0]).toEqual({
      id: 'pk-1',
      code: 'regular',
      name: 'Regular',
      scope: 'tenant',
      currency: 'EUR',
      appliesTo: 'regular',
    })
    expect(items[1]).toEqual({
      id: 'pk-2',
      code: 'promo',
      name: 'Promo',
      scope: 'organization',
      currency: 'USD',
      appliesTo: 'promotion',
    })
  })

  it('rejects missing tenant context', async () => {
    const ctx = makeCtxWithSearch()
    const noTenant = { ...ctx, tenantId: null }
    await expect(tool.handler({}, noTenant as any)).rejects.toThrow(/Tenant context is required/)
  })
})
