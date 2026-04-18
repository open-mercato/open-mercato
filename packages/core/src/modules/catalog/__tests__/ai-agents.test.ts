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

import aiAgents, { promptTemplate } from '../ai-agents'
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
  const agent = aiAgents[0]

  it('registers a single agent exported as default and named aiAgents', () => {
    expect(aiAgents).toHaveLength(1)
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

  it('resolvePageContext is an async identity stub that yields no extra context', async () => {
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
