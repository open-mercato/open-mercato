import type { AiAgentDefinition } from '../ai-agent-definition'
import {
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

  it('returns an empty registry when the generated file is absent (dynamic import throws)', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    await loadAgentRegistry()

    expect(listAgents()).toEqual([])
    expect(getAgent('anything')).toBeUndefined()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[AI Agents] Could not load ai-agents.generated.ts'),
      expect.any(Object)
    )
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

  it('loadAgentRegistry is idempotent — repeat calls do not duplicate entries or re-warn', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    await loadAgentRegistry()
    await loadAgentRegistry()
    await loadAgentRegistry()

    expect(listAgents()).toEqual([])
    expect(errorSpy).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
  })
})
