/**
 * Step 4.8 — unit coverage for the first catalog AI agent definition
 * (catalog.catalog_assistant). Mirrors the Step 4.7 customers agent
 * suite, adjusted for the catalog tool packs.
 *
 * The test explicitly asserts that D18 merchandising tools and every
 * authoring tool stay OUT of this agent's whitelist — those belong to
 * Step 4.9's `catalog.merchandising_assistant` and duplicating them
 * here would let the generic catalog agent shadow the demo entry
 * point.
 */
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(),
}))

import aiAgents, { promptTemplate, merchandisingPromptTemplate } from '../ai-agents'
import features from '../acl'
import catalogAiTools from '../ai-tools'

const GENERAL_PURPOSE_TOOLS = new Set([
  'search.hybrid_search',
  'search.get_record_context',
  'attachments.list_record_attachments',
  'attachments.read_attachment',
  'meta.describe_agent',
])

const BASE_CATALOG_READ_TOOLS = new Set([
  'catalog.list_products',
  'catalog.get_product',
  'catalog.list_categories',
  'catalog.get_category',
  'catalog.list_variants',
  'catalog.list_prices',
  'catalog.list_price_kinds_base',
  'catalog.list_offers',
  'catalog.list_product_media',
  'catalog.list_product_tags',
  'catalog.list_option_schemas',
  'catalog.list_unit_conversions',
])

const D18_MERCHANDISING_DENY_LIST = [
  'catalog.search_products',
  'catalog.get_product_bundle',
  'catalog.list_selected_products',
  'catalog.get_product_media',
  'catalog.get_attribute_schema',
  'catalog.get_category_brief',
  'catalog.list_price_kinds',
]

const AUTHORING_DENY_LIST = [
  'catalog.draft_description_from_attributes',
  'catalog.extract_attributes_from_description',
  'catalog.draft_description_from_media',
  'catalog.suggest_title_variants',
  'catalog.suggest_price_adjustment',
]

const EXPECTED_SECTION_ORDER = [
  'role',
  'scope',
  'data',
  'tools',
  'attachments',
  'mutationPolicy',
  'responseStyle',
] as const

describe('catalog.catalog_assistant agent definition', () => {
  const agent = aiAgents.find((entry) => entry.id === 'catalog.catalog_assistant')!

  it('registers the catalog_assistant agent exported as default and named aiAgents', () => {
    expect(aiAgents.length).toBeGreaterThanOrEqual(1)
    expect(agent).toBeDefined()
    expect(agent.id).toBe('catalog.catalog_assistant')
    expect(agent.moduleId).toBe('catalog')
  })

  it('is strictly read-only at the definition level', () => {
    expect(agent.readOnly).toBe(true)
    expect(agent.mutationPolicy).toBe('read-only')
  })

  it('declares the expected execution metadata', () => {
    expect(agent.executionMode).toBe('chat')
    expect(agent.defaultModel).toBeUndefined()
    expect(agent.maxSteps).toBeUndefined()
    expect(agent.output).toBeUndefined()
    expect(agent.acceptedMediaTypes).toEqual(['image', 'pdf', 'file'])
  })

  it('whitelists only read-only tools that exist in the catalog base pack or general-purpose packs', () => {
    const catalogToolNames = new Set(catalogAiTools.map((tool) => tool.name))
    for (const toolName of agent.allowedTools) {
      const isBaseCatalog = BASE_CATALOG_READ_TOOLS.has(toolName) && catalogToolNames.has(toolName)
      const isGeneral = GENERAL_PURPOSE_TOOLS.has(toolName)
      expect(isBaseCatalog || isGeneral).toBe(true)
    }
  })

  it('never whitelists a mutation tool from the catalog pack', () => {
    for (const tool of catalogAiTools) {
      if (!tool.isMutation) continue
      expect(agent.allowedTools).not.toContain(tool.name)
    }
  })

  it('explicitly excludes every D18 merchandising tool (owned by catalog.merchandising_assistant in Step 4.9)', () => {
    for (const toolName of D18_MERCHANDISING_DENY_LIST) {
      expect(agent.allowedTools).not.toContain(toolName)
    }
  })

  it('explicitly excludes every catalog authoring tool (owned by catalog.merchandising_assistant in Step 4.9)', () => {
    for (const toolName of AUTHORING_DENY_LIST) {
      expect(agent.allowedTools).not.toContain(toolName)
    }
  })

  it('every requiredFeatures entry exists in catalog/acl.ts', () => {
    const knownFeatureIds = new Set(features.map((entry) => entry.id))
    expect(agent.requiredFeatures?.length ?? 0).toBeGreaterThan(0)
    for (const feature of agent.requiredFeatures ?? []) {
      expect(knownFeatureIds.has(feature)).toBe(true)
    }
  })

  it('declares the seven spec §8 prompt sections in the canonical order', () => {
    expect(promptTemplate.id).toBe('catalog.catalog_assistant.prompt')
    const sectionNames = promptTemplate.sections
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((section) => section.name)
    expect(sectionNames).toEqual(EXPECTED_SECTION_ORDER)

    for (const section of promptTemplate.sections) {
      expect(typeof section.content).toBe('string')
      expect(section.content.trim().length).toBeGreaterThan(0)
    }
  })

  it('compiles the prompt template into the agent systemPrompt', () => {
    for (const section of promptTemplate.sections) {
      const firstLine = section.content.split('\n')[0].trim()
      expect(agent.systemPrompt).toContain(firstLine)
    }
  })

  it('resolvePageContext yields no extra context for non-UUID recordIds', async () => {
    expect(typeof agent.resolvePageContext).toBe('function')
    const result = await agent.resolvePageContext!({
      entityType: 'catalog.product',
      recordId: 'fake-record-id',
      container: {} as any,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(result).toBeNull()
  })
})

describe('catalog.merchandising_assistant agent definition (Step 4.9 / Spec §10 D18)', () => {
  const merchandisingAgent = aiAgents.find(
    (entry) => entry.id === 'catalog.merchandising_assistant',
  )!

  const D18_READ_TOOLS = [
    'catalog.search_products',
    'catalog.get_product_bundle',
    'catalog.list_selected_products',
    'catalog.get_product_media',
    'catalog.get_attribute_schema',
    'catalog.get_category_brief',
    'catalog.list_price_kinds',
  ]

  const D18_AUTHORING_TOOLS = [
    'catalog.draft_description_from_attributes',
    'catalog.extract_attributes_from_description',
    'catalog.draft_description_from_media',
    'catalog.suggest_title_variants',
    'catalog.suggest_price_adjustment',
  ]

  const D18_MUTATION_TOOLS = [
    'catalog.update_product',
    'catalog.bulk_update_products',
    'catalog.apply_attribute_extraction',
    'catalog.update_product_media_descriptions',
  ]

  const BASE_CATALOG_LIST_GET_DENY_LIST = [
    'catalog.list_products',
    'catalog.get_product',
    'catalog.list_categories',
    'catalog.get_category',
    'catalog.list_variants',
    'catalog.list_prices',
    'catalog.list_price_kinds_base',
    'catalog.list_offers',
    'catalog.list_product_media',
    'catalog.list_product_tags',
    'catalog.list_option_schemas',
    'catalog.list_unit_conversions',
  ]

  it('is registered as a second catalog agent with the canonical id and module', () => {
    expect(merchandisingAgent).toBeDefined()
    expect(merchandisingAgent.id).toBe('catalog.merchandising_assistant')
    expect(merchandisingAgent.moduleId).toBe('catalog')
    // Two agents coexist: catalog_assistant (Step 4.8) + merchandising_assistant (Step 4.9).
    const ids = aiAgents.map((entry) => entry.id).sort()
    expect(ids).toEqual(['catalog.catalog_assistant', 'catalog.merchandising_assistant'])
  })

  it('is strictly read-only for Phase 2 exit', () => {
    expect(merchandisingAgent.readOnly).toBe(true)
    expect(merchandisingAgent.mutationPolicy).toBe('read-only')
  })

  it('declares the expected execution metadata', () => {
    expect(merchandisingAgent.executionMode).toBe('chat')
    expect(merchandisingAgent.defaultModel).toBeUndefined()
    expect(merchandisingAgent.maxSteps).toBeUndefined()
    expect(merchandisingAgent.output).toBeUndefined()
    expect(merchandisingAgent.acceptedMediaTypes).toEqual(['image', 'pdf', 'file'])
  })

  it('whitelists every D18 read tool', () => {
    for (const toolName of D18_READ_TOOLS) {
      expect(merchandisingAgent.allowedTools).toContain(toolName)
    }
  })

  it('whitelists every D18 authoring tool (structured-output proposals only)', () => {
    for (const toolName of D18_AUTHORING_TOOLS) {
      expect(merchandisingAgent.allowedTools).toContain(toolName)
    }
  })

  it('whitelists every D18 mutation tool (Step 5.14 — pending-action approval contract)', () => {
    for (const toolName of D18_MUTATION_TOOLS) {
      expect(merchandisingAgent.allowedTools).toContain(toolName)
    }
  })

  it('whitelists the general-purpose tool pack', () => {
    for (const toolName of GENERAL_PURPOSE_TOOLS) {
      expect(merchandisingAgent.allowedTools).toContain(toolName)
    }
  })

  it('explicitly excludes every base catalog list/get tool (owned by catalog.catalog_assistant)', () => {
    for (const toolName of BASE_CATALOG_LIST_GET_DENY_LIST) {
      expect(merchandisingAgent.allowedTools).not.toContain(toolName)
    }
  })

  it('whitelists only the Step 5.14 D18 mutation tools from the catalog pack', () => {
    const allowedMutationNames = new Set(D18_MUTATION_TOOLS)
    for (const tool of catalogAiTools) {
      if (!tool.isMutation) continue
      if (allowedMutationNames.has(tool.name)) {
        expect(merchandisingAgent.allowedTools).toContain(tool.name)
      } else {
        expect(merchandisingAgent.allowedTools).not.toContain(tool.name)
      }
    }
  })

  it('every requiredFeatures entry exists in catalog/acl.ts and scopes to catalog.products.view', () => {
    const knownFeatureIds = new Set(features.map((entry) => entry.id))
    expect(merchandisingAgent.requiredFeatures).toEqual(['catalog.products.view'])
    for (const feature of merchandisingAgent.requiredFeatures ?? []) {
      expect(knownFeatureIds.has(feature)).toBe(true)
    }
  })

  it('declares the seven spec §8 prompt sections in the canonical order', () => {
    expect(merchandisingPromptTemplate.id).toBe('catalog.merchandising_assistant.prompt')
    const sectionNames = merchandisingPromptTemplate.sections
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((section) => section.name)
    expect(sectionNames).toEqual(EXPECTED_SECTION_ORDER)

    for (const section of merchandisingPromptTemplate.sections) {
      expect(typeof section.content).toBe('string')
      expect(section.content.trim().length).toBeGreaterThan(0)
    }
  })

  it('compiles the prompt template into the agent systemPrompt', () => {
    for (const section of merchandisingPromptTemplate.sections) {
      const firstLine = section.content.split('\n')[0].trim()
      expect(merchandisingAgent.systemPrompt).toContain(firstLine)
    }
  })

  it('resolvePageContext yields no extra context for unknown entityTypes', async () => {
    expect(typeof merchandisingAgent.resolvePageContext).toBe('function')
    const result = await merchandisingAgent.resolvePageContext!({
      entityType: 'catalog:product-selection',
      recordId: 'uuid-a,uuid-b',
      container: {} as any,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(result).toBeNull()
  })
})

// Step 5.2 — resolvePageContext hydration path.
const VALID_UUID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const VALID_UUID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function buildContainer() {
  return {
    resolve: (name: string) => (name === 'em' ? { count: jest.fn() } : null),
  }
}

async function mockCatalogTool(
  toolName: string,
  handler: jest.Mock,
): Promise<{
  hydrateCatalogAssistantContext: (input: any) => Promise<string | null>
  hydrateMerchandisingAssistantContext: (input: any) => Promise<string | null>
}> {
  jest.doMock('../ai-tools', () => ({
    __esModule: true,
    default: [
      {
        name: toolName,
        description: 'mock',
        inputSchema: { parse: (value: unknown) => value },
        handler,
      },
    ],
    aiTools: [
      {
        name: toolName,
        description: 'mock',
        inputSchema: { parse: (value: unknown) => value },
        handler,
      },
    ],
  }))
  return import('../ai-agents-context')
}

describe('catalog.catalog_assistant resolvePageContext hydration (Step 5.2)', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })
  const originalWarn = console.warn
  afterEach(() => {
    console.warn = originalWarn
  })

  it('returns null when tenantId is missing (cross-tenant guard)', async () => {
    const handler = jest.fn()
    const { hydrateCatalogAssistantContext } = await mockCatalogTool('catalog.get_product', handler)
    const result = await hydrateCatalogAssistantContext({
      entityType: 'catalog.product',
      recordId: VALID_UUID_A,
      container: buildContainer() as any,
      tenantId: null,
      organizationId: 'org-1',
    })
    expect(result).toBeNull()
    expect(handler).not.toHaveBeenCalled()
  })

  it('hydrates a single product via catalog.get_product', async () => {
    const handler = jest.fn(async () => ({
      found: true,
      product: { id: VALID_UUID_A, title: 'Widget' },
    }))
    const { hydrateCatalogAssistantContext } = await mockCatalogTool('catalog.get_product', handler)
    const result = await hydrateCatalogAssistantContext({
      entityType: 'catalog.product',
      recordId: VALID_UUID_A,
      container: buildContainer() as any,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]).toEqual({ productId: VALID_UUID_A })
    expect(handler.mock.calls[0][1]).toMatchObject({ tenantId: 'tenant-1' })
    expect(result).toContain('## Page context — Product')
    expect(result).toContain('Widget')
  })

  it('returns null when the tool reports found=false', async () => {
    const handler = jest.fn(async () => ({ found: false, productId: VALID_UUID_A }))
    const { hydrateCatalogAssistantContext } = await mockCatalogTool('catalog.get_product', handler)
    const result = await hydrateCatalogAssistantContext({
      entityType: 'catalog.product',
      recordId: VALID_UUID_A,
      container: buildContainer() as any,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(result).toBeNull()
  })

  it('returns null without throwing when the tool handler throws', async () => {
    const warn = jest.fn()
    console.warn = warn
    const handler = jest.fn(async () => {
      throw new Error('downstream blew up')
    })
    const { hydrateCatalogAssistantContext } = await mockCatalogTool('catalog.get_product', handler)
    const result = await hydrateCatalogAssistantContext({
      entityType: 'catalog.product',
      recordId: VALID_UUID_A,
      container: buildContainer() as any,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(result).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('hydrates a products-list selection via catalog.list_selected_products and projects summaries', async () => {
    const handler = jest.fn(async (args: any) => ({
      items: (args.productIds as string[]).map((productId) => ({
        found: true,
        product: { id: productId, title: `title-${productId.slice(0, 4)}` },
      })),
      missingIds: [],
    }))
    const { hydrateCatalogAssistantContext } = await mockCatalogTool('catalog.list_selected_products', handler)
    const result = await hydrateCatalogAssistantContext({
      entityType: 'catalog.products.list',
      recordId: `${VALID_UUID_A},${VALID_UUID_B}`,
      container: buildContainer() as any,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]).toEqual({ productIds: [VALID_UUID_A, VALID_UUID_B] })
    expect(result).toContain('Products selection (2 of 2)')
  })

  it('caps the selection at 10 UUIDs (drops the rest)', async () => {
    const manyIds = Array.from({ length: 15 }, (_unused, index) => {
      const hex = index.toString(16).padStart(2, '0')
      // Build a structurally valid v4 UUID per iteration.
      return `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa${hex}`
    })
    const handler = jest.fn(async (args: any) => ({
      items: (args.productIds as string[]).map((productId) => ({ found: true, product: { id: productId } })),
      missingIds: [],
    }))
    const { hydrateCatalogAssistantContext } = await mockCatalogTool('catalog.list_selected_products', handler)
    await hydrateCatalogAssistantContext({
      entityType: 'catalog.products.list',
      recordId: manyIds.join(','),
      container: buildContainer() as any,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0].productIds).toHaveLength(10)
  })

  it('returns null when no UUIDs parse out of recordId', async () => {
    const handler = jest.fn()
    const { hydrateCatalogAssistantContext } = await mockCatalogTool('catalog.list_selected_products', handler)
    const result = await hydrateCatalogAssistantContext({
      entityType: 'catalog.products.list',
      recordId: 'not-a-uuid,also-bad',
      container: buildContainer() as any,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(result).toBeNull()
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('catalog.merchandising_assistant resolvePageContext hydration (Step 5.2)', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })
  const originalWarn = console.warn
  afterEach(() => {
    console.warn = originalWarn
  })

  it('hydrates the full product bundle for a single catalog.product', async () => {
    const handler = jest.fn(async () => ({
      found: true,
      product: { id: VALID_UUID_A, title: 'Widget' },
      categories: [],
      prices: { base: [] },
      media: [],
    }))
    const { hydrateMerchandisingAssistantContext } = await mockCatalogTool(
      'catalog.get_product_bundle',
      handler,
    )
    const result = await hydrateMerchandisingAssistantContext({
      entityType: 'catalog.product',
      recordId: VALID_UUID_A,
      container: buildContainer() as any,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(handler).toHaveBeenCalledWith(
      { productId: VALID_UUID_A },
      expect.objectContaining({ tenantId: 'tenant-1' }),
    )
    expect(result).toContain('## Page context — Product bundle')
  })

  it('hydrates a products-list selection via catalog.list_selected_products (bundles)', async () => {
    const handler = jest.fn(async (args: any) => ({
      items: (args.productIds as string[]).map((productId) => ({
        found: true,
        product: { id: productId, title: `title-${productId.slice(0, 4)}` },
        categories: [],
      })),
      missingIds: [],
    }))
    const { hydrateMerchandisingAssistantContext } = await mockCatalogTool(
      'catalog.list_selected_products',
      handler,
    )
    const result = await hydrateMerchandisingAssistantContext({
      entityType: 'catalog.products.list',
      recordId: `${VALID_UUID_A},${VALID_UUID_B}`,
      container: buildContainer() as any,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]).toEqual({ productIds: [VALID_UUID_A, VALID_UUID_B] })
    expect(result).toContain('Products selection bundles (2 of 2)')
  })

  it('returns null when tenantId is missing (cross-tenant guard)', async () => {
    const handler = jest.fn()
    const { hydrateMerchandisingAssistantContext } = await mockCatalogTool(
      'catalog.get_product_bundle',
      handler,
    )
    const result = await hydrateMerchandisingAssistantContext({
      entityType: 'catalog.product',
      recordId: VALID_UUID_A,
      container: buildContainer() as any,
      tenantId: null,
      organizationId: 'org-1',
    })
    expect(result).toBeNull()
    expect(handler).not.toHaveBeenCalled()
  })

  it('returns null without throwing when the tool handler throws', async () => {
    const warn = jest.fn()
    console.warn = warn
    const handler = jest.fn(async () => {
      throw new Error('downstream blew up')
    })
    const { hydrateMerchandisingAssistantContext } = await mockCatalogTool(
      'catalog.get_product_bundle',
      handler,
    )
    const result = await hydrateMerchandisingAssistantContext({
      entityType: 'catalog.product',
      recordId: VALID_UUID_A,
      container: buildContainer() as any,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(result).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('returns null for unknown entityTypes', async () => {
    const handler = jest.fn()
    const { hydrateMerchandisingAssistantContext } = await mockCatalogTool(
      'catalog.get_product_bundle',
      handler,
    )
    const result = await hydrateMerchandisingAssistantContext({
      entityType: 'catalog.offer',
      recordId: VALID_UUID_A,
      container: buildContainer() as any,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(result).toBeNull()
    expect(handler).not.toHaveBeenCalled()
  })
})
