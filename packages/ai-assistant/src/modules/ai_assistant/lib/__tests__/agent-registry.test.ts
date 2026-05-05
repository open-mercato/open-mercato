import type { AiAgentDefinition } from '../ai-agent-definition'
import {
  applyAgentExtensionEntriesForTests,
  getAgent,
  listAgents,
  listAgentsByModule,
  loadAgentRegistry,
  resetAgentRegistryForTests,
  seedAgentRegistryForTests,
} from '../agent-registry'

function makeAgent(overrides: Partial<AiAgentDefinition> & Pick<AiAgentDefinition, 'id' | 'moduleId'>): AiAgentDefinition {
  return {
    label: `${overrides.id} label`,
    description: `${overrides.id} description`,
    systemPrompt: 'You are a test agent.',
    allowedTools: [],
    ...overrides,
  }
}

describe('agent-registry', () => {
  beforeEach(() => {
    resetAgentRegistryForTests()
  })

  afterAll(() => {
    resetAgentRegistryForTests()
  })

  it('loads generated agents when present and otherwise falls back to an empty registry', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    await loadAgentRegistry()

    const agents = listAgents()
    if (errorSpy.mock.calls.length > 0) {
      expect(agents).toEqual([])
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[AI Agents] Could not load ai-agents.generated.ts'),
        expect.any(Object),
      )
    } else {
      expect(agents.every((agent) => getAgent(agent.id) === agent)).toBe(true)
    }
    errorSpy.mockRestore()
  })

  it('populates the registry from a fixture `allAiAgents` array and returns entries via getAgent', () => {
    const catalogAgent = makeAgent({ id: 'catalog.merchandiser', moduleId: 'catalog' })
    const customersAgent = makeAgent({ id: 'customers.assistant', moduleId: 'customers' })

    seedAgentRegistryForTests([catalogAgent, customersAgent])

    expect(getAgent('catalog.merchandiser')).toBe(catalogAgent)
    expect(getAgent('customers.assistant')).toBe(customersAgent)
    expect(getAgent('unknown.agent')).toBeUndefined()
  })

  it('listAgents() returns all entries stable-sorted by id', () => {
    seedAgentRegistryForTests([
      makeAgent({ id: 'customers.assistant', moduleId: 'customers' }),
      makeAgent({ id: 'catalog.merchandiser', moduleId: 'catalog' }),
      makeAgent({ id: 'catalog.pricing', moduleId: 'catalog' }),
    ])

    expect(listAgents().map((agent) => agent.id)).toEqual([
      'catalog.merchandiser',
      'catalog.pricing',
      'customers.assistant',
    ])
  })

  it('listAgentsByModule filters on moduleId', () => {
    seedAgentRegistryForTests([
      makeAgent({ id: 'catalog.merchandiser', moduleId: 'catalog' }),
      makeAgent({ id: 'catalog.pricing', moduleId: 'catalog' }),
      makeAgent({ id: 'customers.assistant', moduleId: 'customers' }),
    ])

    expect(listAgentsByModule('catalog').map((agent) => agent.id)).toEqual([
      'catalog.merchandiser',
      'catalog.pricing',
    ])
    expect(listAgentsByModule('customers').map((agent) => agent.id)).toEqual([
      'customers.assistant',
    ])
    expect(listAgentsByModule('unknown')).toEqual([])
  })

  it('throws with both module ids when two entries share the same id', () => {
    const first = makeAgent({ id: 'catalog.merchandiser', moduleId: 'catalog' })
    const conflict = makeAgent({ id: 'catalog.merchandiser', moduleId: 'catalog_demo' })

    expect(() => seedAgentRegistryForTests([first, conflict])).toThrow(
      /Duplicate agent id "catalog\.merchandiser".*module "catalog".*module "catalog_demo"/
    )
  })

  it('skips malformed entries with a warning, valid entries still load', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const valid = makeAgent({ id: 'catalog.merchandiser', moduleId: 'catalog' })
    const malformed = {
      id: 'catalog.broken',
      moduleId: 'catalog',
      label: 'broken',
      description: 'broken',
      allowedTools: [],
    } as unknown

    seedAgentRegistryForTests([malformed, valid])

    expect(getAgent('catalog.broken')).toBeUndefined()
    expect(getAgent('catalog.merchandiser')).toBe(valid)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[AI Agents] Skipping malformed agent entry')
    )
    warnSpy.mockRestore()
  })

  it('applies append, delete, and replace extensions to an existing agent', () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.catalog_assistant',
        moduleId: 'catalog',
        systemPrompt: 'Base prompt.',
        allowedTools: ['catalog.list_products', 'catalog.get_product', 'catalog.old_tool'],
        suggestions: [
          { label: 'Find products', prompt: 'Find products' },
          { label: 'Old prompt', prompt: 'Old prompt' },
        ],
      }),
    ])

    applyAgentExtensionEntriesForTests([
      {
        targetAgentId: 'catalog.catalog_assistant',
        deleteAllowedTools: ['catalog.old_tool'],
        appendAllowedTools: ['example.catalog_stats', 'catalog.list_products'],
        replaceSystemPrompt: 'Replacement prompt.',
        appendSystemPrompt: 'Use example.catalog_stats for tenant-specific catalog metrics.',
        deleteSuggestions: ['Old prompt'],
        appendSuggestions: [
          { label: 'Show catalog stats', prompt: 'Show catalog stats' },
        ],
      },
    ])

    expect(getAgent('catalog.catalog_assistant')).toMatchObject({
      allowedTools: ['catalog.list_products', 'catalog.get_product', 'example.catalog_stats'],
      suggestions: [
        { label: 'Find products', prompt: 'Find products' },
        { label: 'Show catalog stats', prompt: 'Show catalog stats' },
      ],
    })
    expect(getAgent('catalog.catalog_assistant')?.systemPrompt).toBe(
      'Replacement prompt.\n\nUse example.catalog_stats for tenant-specific catalog metrics.',
    )
  })

  it('supports full tool and suggestion replacement in an extension', () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.catalog_assistant',
        moduleId: 'catalog',
        allowedTools: ['catalog.list_products'],
        suggestions: [{ label: 'Find products', prompt: 'Find products' }],
      }),
    ])

    applyAgentExtensionEntriesForTests([
      {
        targetAgentId: 'catalog.catalog_assistant',
        replaceAllowedTools: ['example.catalog_stats'],
        replaceSuggestions: [
          { label: 'Show categories', prompt: 'Show categories' },
        ],
      },
    ])

    expect(getAgent('catalog.catalog_assistant')).toMatchObject({
      allowedTools: ['example.catalog_stats'],
      suggestions: [
        { label: 'Show categories', prompt: 'Show categories' },
      ],
    })
  })

  it('resetAgentRegistryForTests clears the cache so a subsequent seed sees fresh fixtures', () => {
    seedAgentRegistryForTests([
      makeAgent({ id: 'catalog.merchandiser', moduleId: 'catalog' }),
    ])
    expect(listAgents()).toHaveLength(1)

    resetAgentRegistryForTests()
    expect(listAgents()).toEqual([])

    seedAgentRegistryForTests([
      makeAgent({ id: 'customers.assistant', moduleId: 'customers' }),
    ])
    expect(listAgents().map((agent) => agent.id)).toEqual(['customers.assistant'])
  })

  it('loadAgentRegistry is idempotent — repeat calls do not duplicate entries', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    await loadAgentRegistry()
    const firstIds = listAgents().map((agent) => agent.id)
    await loadAgentRegistry()
    await loadAgentRegistry()

    expect(listAgents().map((agent) => agent.id)).toEqual(firstIds)
    expect(errorSpy).toHaveBeenCalledTimes(firstIds.length === 0 ? 1 : 0)
    errorSpy.mockRestore()
  })
})
