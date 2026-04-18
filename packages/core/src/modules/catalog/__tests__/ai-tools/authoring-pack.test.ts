/**
 * Step 3.12 — D18 AI-authoring tools unit tests.
 *
 * Covers the five structured-output helpers the
 * `catalog.merchandising_assistant` agent will whitelist in Step 4.9:
 *
 * - `catalog.draft_description_from_attributes`
 * - `catalog.extract_attributes_from_description`
 * - `catalog.draft_description_from_media`
 * - `catalog.suggest_title_variants`
 * - `catalog.suggest_price_adjustment`
 *
 * Authoring tools NEVER write to the database and NEVER make a fresh model
 * call from inside the handler. Each returns a
 * `{ proposal, context, outputSchemaDescriptor }` contract; these tests
 * assert the contract shape, tenant scoping, RBAC gating, and
 * structured-output descriptor JSON Schema well-formedness.
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

import authoringAiTools from '../../ai-tools/authoring-pack'
import aiTools from '../../ai-tools'
import { knownFeatureIds } from './shared'

function findTool(name: string) {
  const tool = authoringAiTools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`tool ${name} missing`)
  return tool
}

function makeAuthoringCtx(overrides: {
  pricingService?: { resolvePrice: jest.Mock } | null
} = {}) {
  const em = {
    count: jest.fn().mockResolvedValue(0),
    persistAndFlush: jest.fn().mockResolvedValue(undefined),
  }
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return em
      if (name === 'catalogPricingService') {
        if (overrides.pricingService === null) {
          throw new Error('resolver_unavailable')
        }
        return (
          overrides.pricingService ?? {
            resolvePrice: jest.fn().mockResolvedValue(null),
          }
        )
      }
      throw new Error(`unexpected resolve: ${name}`)
    }),
  }
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    container: container as any,
    userFeatures: [
      'catalog.products.view',
      'catalog.categories.view',
      'catalog.pricing.manage',
      'catalog.settings.manage',
    ],
    isSuperAdmin: false,
    em,
  }
}

const PRODUCT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const MISSING_ID = '0e4a4e66-2894-4f6c-96bb-fdfa32a9177b'

function seedProductHit(overrides: Partial<{ description: string | null; title: string }> = {}) {
  findOneWithDecryptionMock.mockResolvedValue({
    id: PRODUCT_ID,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    title: overrides.title ?? 'Blue Widget',
    productType: 'simple',
    primaryCurrencyCode: 'USD',
    isActive: true,
    description: overrides.description ?? 'A sturdy blue widget for workshops.',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
  })
}

beforeEach(() => {
  findWithDecryptionMock.mockReset()
  findWithDecryptionMock.mockResolvedValue([])
  findOneWithDecryptionMock.mockReset()
  loadCustomFieldValuesMock.mockReset()
  loadCustomFieldValuesMock.mockResolvedValue({})
  loadCustomFieldDefinitionIndexMock.mockReset()
  loadCustomFieldDefinitionIndexMock.mockResolvedValue(new Map())
})

describe('authoring pack — RBAC + isMutation contract', () => {
  it('every tool is non-mutation and declares a requiredFeatures that exists in acl.ts', () => {
    expect(authoringAiTools).toHaveLength(5)
    for (const tool of authoringAiTools) {
      expect(tool.isMutation).toBe(false)
      expect(tool.requiredFeatures?.length ?? 0).toBeGreaterThan(0)
      for (const feature of tool.requiredFeatures!) {
        expect(knownFeatureIds.has(feature)).toBe(true)
      }
    }
  })

  it('catalog.suggest_price_adjustment explicitly carries isMutation: false (spec §7 callout)', () => {
    const tool = findTool('catalog.suggest_price_adjustment')
    expect(tool.isMutation).toBe(false)
  })

  it('every tool exposes a well-formed JSON Schema output descriptor', async () => {
    seedProductHit()
    const ctx = makeAuthoringCtx()
    for (const tool of authoringAiTools) {
      const base: Record<string, unknown> = { productId: PRODUCT_ID }
      if (tool.name === 'catalog.suggest_title_variants') base.targetStyle = 'short'
      if (tool.name === 'catalog.suggest_price_adjustment') base.intent = 'raise price by 10%'
      const result = (await tool.handler(base, ctx as any)) as Record<string, unknown>
      expect(result.found).toBe(true)
      const descriptor = result.outputSchemaDescriptor as Record<string, unknown>
      expect(descriptor).toBeDefined()
      expect(typeof descriptor.schemaName).toBe('string')
      expect(typeof descriptor.jsonSchema).toBe('object')
      const jsonSchema = descriptor.jsonSchema as Record<string, unknown>
      expect(jsonSchema.type).toBe('object')
    }
  })
})

describe('catalog.draft_description_from_attributes', () => {
  const tool = findTool('catalog.draft_description_from_attributes')

  it('returns { found: false } when the product is missing (no throw)', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)
    const ctx = makeAuthoringCtx()
    const result = (await tool.handler({ productId: MISSING_ID }, ctx as any)) as Record<
      string,
      unknown
    >
    expect(result.found).toBe(false)
    expect(result.productId).toBe(MISSING_ID)
  })

  it('returns an empty proposal template plus product context and output descriptor on hit', async () => {
    seedProductHit()
    const ctx = makeAuthoringCtx()
    const result = (await tool.handler(
      { productId: PRODUCT_ID, tonePreference: 'marketing' },
      ctx as any,
    )) as Record<string, unknown>
    expect(result.found).toBe(true)
    const proposal = result.proposal as Record<string, unknown>
    expect(proposal.description).toBe('')
    expect(proposal.rationale).toBe('')
    expect(proposal.attributesUsed).toEqual([])
    const context = result.context as Record<string, unknown>
    expect(context.tonePreference).toBe('marketing')
    expect((context.product as Record<string, unknown>).id).toBe(PRODUCT_ID)
  })

  it('defaults tonePreference to neutral when omitted', async () => {
    seedProductHit()
    const ctx = makeAuthoringCtx()
    const result = (await tool.handler({ productId: PRODUCT_ID }, ctx as any)) as Record<
      string,
      unknown
    >
    expect((result.context as Record<string, unknown>).tonePreference).toBe('neutral')
  })
})

describe('catalog.extract_attributes_from_description', () => {
  const tool = findTool('catalog.extract_attributes_from_description')

  it('uses the stored product description when no override is provided', async () => {
    seedProductHit({ description: 'Stored description text.' })
    const ctx = makeAuthoringCtx()
    const result = (await tool.handler({ productId: PRODUCT_ID }, ctx as any)) as Record<
      string,
      unknown
    >
    const context = result.context as Record<string, unknown>
    expect(context.description).toBe('Stored description text.')
    expect(context.attributeSchema).toEqual(
      expect.objectContaining({ fields: expect.any(Array) }),
    )
  })

  it('uses descriptionOverride when supplied', async () => {
    seedProductHit({ description: 'Old description.' })
    const ctx = makeAuthoringCtx()
    const result = (await tool.handler(
      { productId: PRODUCT_ID, descriptionOverride: 'Fresh text from the user.' },
      ctx as any,
    )) as Record<string, unknown>
    expect((result.context as Record<string, unknown>).description).toBe(
      'Fresh text from the user.',
    )
  })
})

describe('catalog.draft_description_from_media', () => {
  const tool = findTool('catalog.draft_description_from_media')

  it('drops cross-tenant userUploadedAttachmentIds from the context', async () => {
    seedProductHit()
    const okAttachmentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const crossAttachmentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    // First call: assignments/tags/variants/prices/mediaAttachments/unitConversions
    // during buildProductBundle all resolve to empty arrays from the default
    // mock. The next findWithDecryption call is loadUserMedia — return only the
    // tenant-scoped row; cross-tenant id is dropped at the tenant filter.
    findWithDecryptionMock.mockImplementation((...args: unknown[]) => {
      const where = (args[2] ?? {}) as Record<string, unknown>
      if (
        where &&
        typeof where === 'object' &&
        'id' in where &&
        where.id &&
        typeof where.id === 'object' &&
        Array.isArray((where.id as any).$in)
      ) {
        // loadUserMedia path.
        return Promise.resolve([
          {
            id: okAttachmentId,
            tenantId: 'tenant-1',
            fileName: 'hero.jpg',
            mimeType: 'image/jpeg',
            fileSize: 1024,
          },
        ])
      }
      return Promise.resolve([])
    })
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const ctx = makeAuthoringCtx()
      const result = (await tool.handler(
        {
          productId: PRODUCT_ID,
          userUploadedAttachmentIds: [okAttachmentId, crossAttachmentId],
        },
        ctx as any,
      )) as Record<string, unknown>
      const context = result.context as Record<string, unknown>
      const userMedia = context.userMedia as Array<Record<string, unknown>>
      expect(userMedia).toHaveLength(1)
      expect(userMedia[0].attachmentId).toBe(okAttachmentId)
      expect(warnSpy).toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('does NOT fetch attachment bytes — only surfaces ids + metadata', async () => {
    seedProductHit()
    const ctx = makeAuthoringCtx()
    const result = (await tool.handler(
      { productId: PRODUCT_ID, userUploadedAttachmentIds: [] },
      ctx as any,
    )) as Record<string, unknown>
    const context = result.context as Record<string, unknown>
    const productMedia = context.productMedia as Array<Record<string, unknown>>
    for (const entry of productMedia) {
      expect('bytes' in entry).toBe(false)
      expect('content' in entry).toBe(false)
      expect('signedUrl' in entry).toBe(false)
    }
  })
})

describe('catalog.suggest_title_variants', () => {
  const tool = findTool('catalog.suggest_title_variants')

  it('defaults maxVariants to 3', async () => {
    seedProductHit()
    const ctx = makeAuthoringCtx()
    const result = (await tool.handler(
      { productId: PRODUCT_ID, targetStyle: 'short' },
      ctx as any,
    )) as Record<string, unknown>
    expect((result.context as Record<string, unknown>).maxVariants).toBe(3)
  })

  it('caps maxVariants at 5 via zod', () => {
    expect(tool.inputSchema.safeParse({ productId: PRODUCT_ID, targetStyle: 'short', maxVariants: 6 }).success).toBe(
      false,
    )
  })

  it('passes through an accepted maxVariants value', async () => {
    seedProductHit()
    const ctx = makeAuthoringCtx()
    const result = (await tool.handler(
      { productId: PRODUCT_ID, targetStyle: 'seo', maxVariants: 5 },
      ctx as any,
    )) as Record<string, unknown>
    expect((result.context as Record<string, unknown>).maxVariants).toBe(5)
  })

  it('rejects an empty targetStyle', () => {
    expect(tool.inputSchema.safeParse({ productId: PRODUCT_ID, targetStyle: 'other' }).success).toBe(false)
  })
})

describe('catalog.suggest_price_adjustment', () => {
  const tool = findTool('catalog.suggest_price_adjustment')

  function seedProductWithPrices() {
    findOneWithDecryptionMock.mockResolvedValue({
      id: PRODUCT_ID,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      title: 'Blue Widget',
      productType: 'simple',
      primaryCurrencyCode: 'EUR',
      isActive: true,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-02'),
    })
    // Seed prices on the in-bundle query path. buildProductBundle calls
    // findWithDecryption for the price rows plus several other reads; the
    // simplest approach is to return the price shape from any call whose
    // second argument is the price entity.
    findWithDecryptionMock.mockImplementation((...args: unknown[]) => {
      const entity = args[1] as { name?: string }
      if (entity?.name === 'CatalogProductPrice') {
        return Promise.resolve([
          {
            id: 'price-1',
            tenantId: 'tenant-1',
            currencyCode: 'EUR',
            kind: 'base',
            minQuantity: 1,
            unitPriceNet: '100.00',
            unitPriceGross: '123.00',
            priceKind: { id: 'pk-1' },
          },
        ])
      }
      if (entity?.name === 'CatalogPriceKind') {
        return Promise.resolve([
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
        ])
      }
      return Promise.resolve([])
    })
  }

  it('resolves current price via catalogPricingService when available', async () => {
    seedProductWithPrices()
    const ctx = makeAuthoringCtx({
      pricingService: {
        resolvePrice: jest.fn().mockResolvedValue({
          id: 'price-1',
          currencyCode: 'EUR',
          unitPriceNet: '100.00',
          unitPriceGross: '123.00',
          priceKindId: 'pk-1',
        }),
      },
    })
    const result = (await tool.handler(
      { productId: PRODUCT_ID, intent: 'raise price by 10%' },
      ctx as any,
    )) as Record<string, unknown>
    const proposal = result.proposal as Record<string, unknown>
    const currentPrice = proposal.currentPrice as Record<string, unknown>
    expect(currentPrice).toEqual(expect.objectContaining({ amount: 123, currency: 'EUR', priceKindId: 'pk-1' }))
  })

  it('falls back to the bundle view when the pricing service is unavailable (resolver_unavailable)', async () => {
    seedProductWithPrices()
    const ctx = makeAuthoringCtx({
      pricingService: {
        // Throws to simulate a resolver failure → handler must fall back to
        // the bundle-projected current price instead of bubbling the error.
        resolvePrice: jest.fn().mockRejectedValue(new Error('resolver_unavailable')),
      },
    })
    const result = (await tool.handler(
      { productId: PRODUCT_ID, intent: 'raise price by 10%' },
      ctx as any,
    )) as Record<string, unknown>
    const proposal = result.proposal as Record<string, unknown>
    const currentPrice = proposal.currentPrice as Record<string, unknown>
    expect(currentPrice).toEqual(expect.objectContaining({ amount: 123, currency: 'EUR', priceKindId: 'pk-1' }))
  })

  it('returns null current price when no prices are defined', async () => {
    seedProductHit()
    const ctx = makeAuthoringCtx()
    const result = (await tool.handler(
      { productId: PRODUCT_ID, intent: 'set a baseline' },
      ctx as any,
    )) as Record<string, unknown>
    const proposal = result.proposal as Record<string, unknown>
    expect(proposal.currentPrice).toBeNull()
  })

  it('rejects empty intent via zod', () => {
    expect(tool.inputSchema.safeParse({ productId: PRODUCT_ID, intent: '   ' }).success).toBe(false)
  })
})

describe('authoring pack — aggregator coexistence', () => {
  it('ships all five D18 authoring tool names alongside the merchandising pack', () => {
    const names = new Set(aiTools.map((tool) => tool.name))
    for (const expected of [
      'catalog.draft_description_from_attributes',
      'catalog.extract_attributes_from_description',
      'catalog.draft_description_from_media',
      'catalog.suggest_title_variants',
      'catalog.suggest_price_adjustment',
    ]) {
      expect(names.has(expected)).toBe(true)
    }
    // Merchandising-pack coexistence sanity check.
    expect(names.has('catalog.get_product_bundle')).toBe(true)
    expect(names.has('catalog.search_products')).toBe(true)
  })
})
