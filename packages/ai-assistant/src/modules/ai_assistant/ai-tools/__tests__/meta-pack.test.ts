/**
 * Step 3.8 — `meta.*` tool pack unit tests.
 *
 * Covers `list_agents` empty-registry graceful case, RBAC filtering,
 * super-admin bypass, `describe_agent` not-found / forbidden / happy,
 * `update_task_plan` sanitization, and the `output.schema` JSON-Schema
 * fallback.
 */
// The registry's generated-file fallback loads whatever agents the working tree
// has generated (e.g. enterprise agent_orchestrator ships real agents), which
// breaks the empty-registry cases on branches where those modules exist. Stub
// the fallback so the registry only contains what each test seeds explicitly.
jest.mock('../../lib/generated-registry-loader', () => ({
  ...jest.requireActual('../../lib/generated-registry-loader'),
  findGeneratedFile: jest.fn(() => null),
  compileAndImportGenerated: jest.fn(async () => null),
}))

import { z } from 'zod'
import type { AiAgentDefinition } from '../../lib/ai-agent-definition'
import {
  resetAgentRegistryForTests,
  seedAgentRegistryForTests,
} from '../../lib/agent-registry'
import * as agentRegistry from '../../lib/agent-registry'
import metaAiTools from '../meta-pack'

function findTool(name: string) {
  const tool = metaAiTools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`tool ${name} missing`)
  return tool
}

function makeAgent(overrides: Partial<AiAgentDefinition> & Pick<AiAgentDefinition, 'id' | 'moduleId'>): AiAgentDefinition {
  return {
    label: `${overrides.id} label`,
    description: `${overrides.id} description`,
    systemPrompt: 'You are a test agent.',
    allowedTools: [],
    ...overrides,
  }
}

function makeCtx(overrides: Partial<{
  tenantId: string | null
  organizationId: string | null
  userId: string | null
  userFeatures: string[]
  isSuperAdmin: boolean
}> = {}) {
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    container: { resolve: jest.fn() },
    userFeatures: ['ai_assistant.view'],
    isSuperAdmin: false,
    ...overrides,
  }
}

describe('meta.list_agents', () => {
  const tool = findTool('meta.list_agents')

  beforeEach(() => {
    resetAgentRegistryForTests()
  })

  afterAll(() => {
    resetAgentRegistryForTests()
  })

  it('returns an empty array when the registry is empty (never throws)', async () => {
    const ctx = makeCtx()
    const result = (await tool.handler({}, ctx as any)) as Record<string, unknown>
    expect(result.agents).toEqual([])
    expect(result.total).toBe(0)
  })

  it('filters by requiredFeatures based on the caller user features', async () => {
    seedAgentRegistryForTests([
      makeAgent({ id: 'catalog.read', moduleId: 'catalog', requiredFeatures: ['catalog.view'] }),
      makeAgent({ id: 'catalog.write', moduleId: 'catalog', requiredFeatures: ['catalog.manage'] }),
      makeAgent({ id: 'customers.read', moduleId: 'customers' }),
    ])
    const ctx = makeCtx({ userFeatures: ['catalog.view', 'ai_assistant.view'] })
    const result = (await tool.handler({}, ctx as any)) as Record<string, unknown>
    const agents = result.agents as Array<Record<string, unknown>>
    const ids = agents.map((agent) => agent.id).sort()
    expect(ids).toEqual(['catalog.read', 'customers.read'])
  })

  it('super-admin sees every agent regardless of requiredFeatures', async () => {
    seedAgentRegistryForTests([
      makeAgent({ id: 'catalog.admin', moduleId: 'catalog', requiredFeatures: ['catalog.admin_only'] }),
      makeAgent({ id: 'customers.mgr', moduleId: 'customers', requiredFeatures: ['customers.manage'] }),
    ])
    const ctx = makeCtx({ userFeatures: [], isSuperAdmin: true })
    const result = (await tool.handler({}, ctx as any)) as Record<string, unknown>
    const agents = result.agents as Array<Record<string, unknown>>
    expect(agents.map((agent) => agent.id).sort()).toEqual(['catalog.admin', 'customers.mgr'])
  })

  it('filters by moduleId when provided', async () => {
    seedAgentRegistryForTests([
      makeAgent({ id: 'catalog.a', moduleId: 'catalog' }),
      makeAgent({ id: 'customers.a', moduleId: 'customers' }),
    ])
    const ctx = makeCtx({ userFeatures: ['*'] })
    const result = (await tool.handler({ moduleId: 'customers' }, ctx as any)) as Record<string, unknown>
    const agents = result.agents as Array<Record<string, unknown>>
    expect(agents.map((agent) => agent.id)).toEqual(['customers.a'])
  })
})

describe('meta.describe_agent', () => {
  const tool = findTool('meta.describe_agent')

  beforeEach(() => {
    resetAgentRegistryForTests()
  })

  afterAll(() => {
    resetAgentRegistryForTests()
  })

  it('returns { agent: null, reason: "not_found" } when the id is unknown', async () => {
    const ctx = makeCtx()
    const result = (await tool.handler({ agentId: 'no.such.agent' }, ctx as any)) as Record<string, unknown>
    expect(result.agent).toBeNull()
    expect(result.reason).toBe('not_found')
  })

  it('returns { agent: null, reason: "forbidden" } when RBAC denies access', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.private',
        moduleId: 'catalog',
        requiredFeatures: ['catalog.private_feature'],
      }),
    ])
    const ctx = makeCtx({ userFeatures: ['ai_assistant.view'] })
    const result = (await tool.handler({ agentId: 'catalog.private' }, ctx as any)) as Record<string, unknown>
    expect(result.agent).toBeNull()
    expect(result.reason).toBe('forbidden')
  })

  it('returns a serialized description with JSON-Schema output when representable', async () => {
    const schema = z.object({
      title: z.string(),
      price: z.number(),
    })
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.merch',
        moduleId: 'catalog',
        description: 'Merchandising helper',
        allowedTools: ['search.hybrid_search', 'catalog.get_product_bundle'],
        executionMode: 'object',
        readOnly: true,
        mutationPolicy: 'read-only',
        acceptedMediaTypes: ['image', 'pdf'],
        taskPlan: { enabled: true },
        maxSteps: 6,
        output: { schemaName: 'MerchProposal', schema, mode: 'generate' },
        keywords: ['catalog', 'merch'],
        domain: 'catalog',
      }),
    ])
    const ctx = makeCtx({ userFeatures: ['ai_assistant.view'] })
    const result = (await tool.handler({ agentId: 'catalog.merch' }, ctx as any)) as Record<string, unknown>
    const agent = result.agent as Record<string, unknown>
    expect(agent.id).toBe('catalog.merch')
    expect(agent.executionMode).toBe('object')
    expect(agent.allowedTools).toEqual([
      'search.hybrid_search',
      'catalog.get_product_bundle',
      'meta.update_task_plan',
    ])
    expect(agent.readOnly).toBe(true)
    expect(agent.acceptedMediaTypes).toEqual(['image', 'pdf'])
    expect(agent.taskPlan).toEqual({ enabled: true })
    const output = agent.output as Record<string, unknown>
    expect(output.schemaName).toBe('MerchProposal')
    expect(output.jsonSchema).toBeDefined()
    const prompt = agent.prompt as Record<string, unknown>
    expect(prompt.systemPrompt).toBe('You are a test agent.')
    expect(prompt.hasDynamicPageContext).toBe(false)
  })

  it('still returns the agent when output.schema is non-serializable — falls back to a note', async () => {
    const brokenSchema = { _def: { typeName: 'ZodUnknown' } } as unknown as z.ZodType
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.broken',
        moduleId: 'catalog',
        output: { schemaName: 'Broken', schema: brokenSchema },
      }),
    ])
    const ctx = makeCtx({ userFeatures: ['ai_assistant.view'] })
    const result = (await tool.handler({ agentId: 'catalog.broken' }, ctx as any)) as Record<string, unknown>
    const agent = result.agent as Record<string, unknown>
    const output = agent.output as Record<string, unknown>
    expect(output.schemaName).toBe('Broken')
    const hasJsonSchema = Object.prototype.hasOwnProperty.call(output, 'jsonSchema')
    const hasNote = Object.prototype.hasOwnProperty.call(output, 'note')
    expect(hasJsonSchema || hasNote).toBe(true)
  })

  it('hasPageContextResolver reflects whether the agent declared a resolvePageContext callback', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.page',
        moduleId: 'catalog',
        resolvePageContext: async () => 'context',
      }),
    ])
    const ctx = makeCtx({ userFeatures: ['ai_assistant.view'] })
    const result = (await tool.handler({ agentId: 'catalog.page' }, ctx as any)) as Record<string, unknown>
    const agent = result.agent as Record<string, unknown>
    expect(agent.hasPageContextResolver).toBe(true)
    const prompt = agent.prompt as Record<string, unknown>
    expect(prompt.hasDynamicPageContext).toBe(true)
  })
})

describe('meta.update_task_plan', () => {
  const tool = findTool('meta.update_task_plan')

  it('returns sanitized user-visible task labels', async () => {
    const ctx = makeCtx()
    const result = (await tool.handler(
      {
        tasks: [
          {
            id: ' step one ',
            label: '  Search catalog products  ',
            detail: '  Use product search  ',
            toolName: 'catalog__search_products',
          },
        ],
      },
      ctx as any,
    )) as Record<string, unknown>

    expect(result.ok).toBe(true)
    expect(result.accepted).toBe(1)
    expect(result.tasks).toEqual([
      {
        id: 'step-one',
        label: 'Search catalog products',
        detail: 'Use product search',
        toolName: 'catalog.search_products',
      },
    ])
  })

  it('rejects hidden-reasoning-like labels at schema validation', () => {
    expect(() =>
      tool.inputSchema.parse({
        tasks: [
          {
            label: '<thinking>First I will inspect private chain of thought</thinking>',
          },
        ],
      }),
    ).toThrow(/private reasoning|Task-plan labels/i)
  })

  it('does not expose mutation capability', () => {
    expect(tool.isMutation).not.toBe(true)
    expect(tool.requiredFeatures).toEqual(['ai_assistant.view'])
  })
})

describe('meta-pack registry bootstrap', () => {
  let loadSpy: jest.SpyInstance

  beforeEach(() => {
    resetAgentRegistryForTests()
    loadSpy = jest
      .spyOn(agentRegistry, 'loadAgentRegistry')
      .mockResolvedValue(undefined)
  })

  afterEach(() => {
    loadSpy.mockRestore()
    resetAgentRegistryForTests()
  })

  it('lazy-loads the registry before listing agents (standalone MCP has no bootstrap)', async () => {
    const tool = findTool('meta.list_agents')
    await tool.handler({}, makeCtx() as any)
    expect(loadSpy).toHaveBeenCalledTimes(1)
  })

  it('lazy-loads the registry before describing an agent', async () => {
    const tool = findTool('meta.describe_agent')
    await tool.handler({ agentId: 'whatever' }, makeCtx() as any)
    expect(loadSpy).toHaveBeenCalledTimes(1)
  })
})

describe('meta-pack tool surface', () => {
  it('exports the read-only meta tools', () => {
    const names = metaAiTools.map((tool) => tool.name)
    expect(names).toEqual(['meta.list_agents', 'meta.describe_agent', 'meta.update_task_plan'])
    for (const tool of metaAiTools) {
      expect(tool.isMutation).not.toBe(true)
      expect(tool.requiredFeatures).toEqual(['ai_assistant.view'])
    }
  })
})
