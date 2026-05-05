import { z } from 'zod'
import type { AiAgentDefinition } from '../ai-agent-definition'
import type { AiToolDefinition } from '../types'
import { checkAgentPolicy } from '../agent-policy'
import { resetAgentRegistryForTests, seedAgentRegistryForTests } from '../agent-registry'
import { toolRegistry, registerMcpTool } from '../tool-registry'

function makeAgent(
  overrides: Partial<AiAgentDefinition> & Pick<AiAgentDefinition, 'id' | 'moduleId'>
): AiAgentDefinition {
  return {
    label: `${overrides.id} label`,
    description: `${overrides.id} description`,
    systemPrompt: 'You are a test agent.',
    allowedTools: [],
    ...overrides,
  }
}

function makeTool(
  overrides: Partial<AiToolDefinition> & Pick<AiToolDefinition, 'name'>
): AiToolDefinition {
  return {
    description: `${overrides.name} description`,
    inputSchema: z.object({}),
    handler: async () => ({ ok: true }),
    ...overrides,
  }
}

const baseAuth = { userFeatures: [] as string[], isSuperAdmin: false }

describe('agent-policy', () => {
  beforeEach(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  afterAll(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  it('returns agent_unknown when the agent id does not resolve', () => {
    const decision = checkAgentPolicy({
      agentId: 'missing.agent',
      authContext: { userFeatures: ['*'], isSuperAdmin: true },
    })

    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.code).toBe('agent_unknown')
  })

  it('returns agent_features_denied when user lacks required features', () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'customers.assistant',
        moduleId: 'customers',
        requiredFeatures: ['customers.assistant.use'],
      }),
    ])

    const decision = checkAgentPolicy({
      agentId: 'customers.assistant',
      authContext: { userFeatures: ['catalog.view'], isSuperAdmin: false },
    })

    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.code).toBe('agent_features_denied')
  })

  it('super-admin bypasses agent requiredFeatures', () => {
    const agent = makeAgent({
      id: 'customers.assistant',
      moduleId: 'customers',
      requiredFeatures: ['customers.assistant.use'],
    })
    seedAgentRegistryForTests([agent])

    const decision = checkAgentPolicy({
      agentId: 'customers.assistant',
      authContext: { userFeatures: [], isSuperAdmin: true },
    })

    expect(decision.ok).toBe(true)
    if (decision.ok) expect(decision.agent).toBe(agent)
  })

  it('returns tool_not_whitelisted when toolName is not in allowedTools', () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'customers.assistant',
        moduleId: 'customers',
        allowedTools: ['customers_search'],
      }),
    ])

    const decision = checkAgentPolicy({
      agentId: 'customers.assistant',
      authContext: { userFeatures: ['*'], isSuperAdmin: false },
      toolName: 'customers_delete',
    })

    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.code).toBe('tool_not_whitelisted')
  })

  it('returns tool_unknown when tool is whitelisted but not registered', () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'customers.assistant',
        moduleId: 'customers',
        allowedTools: ['customers_search'],
      }),
    ])

    const decision = checkAgentPolicy({
      agentId: 'customers.assistant',
      authContext: { userFeatures: ['*'], isSuperAdmin: false },
      toolName: 'customers_search',
    })

    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.code).toBe('tool_unknown')
  })

  it('returns tool_features_denied when tool requiredFeatures are not satisfied', () => {
    registerMcpTool(
      makeTool({
        name: 'customers_search',
        requiredFeatures: ['customers.people.view'],
      }),
      { moduleId: 'customers' }
    )
    seedAgentRegistryForTests([
      makeAgent({
        id: 'customers.assistant',
        moduleId: 'customers',
        allowedTools: ['customers_search'],
      }),
    ])

    const decision = checkAgentPolicy({
      agentId: 'customers.assistant',
      authContext: { userFeatures: ['catalog.view'], isSuperAdmin: false },
      toolName: 'customers_search',
    })

    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.code).toBe('tool_features_denied')
  })

  it('returns mutation_blocked_by_readonly for explicit readOnly: true + isMutation tool', () => {
    registerMcpTool(
      makeTool({ name: 'customers_update', isMutation: true }),
      { moduleId: 'customers' }
    )
    seedAgentRegistryForTests([
      makeAgent({
        id: 'customers.assistant',
        moduleId: 'customers',
        allowedTools: ['customers_update'],
        readOnly: true,
      }),
    ])

    const decision = checkAgentPolicy({
      agentId: 'customers.assistant',
      authContext: { userFeatures: ['*'], isSuperAdmin: false },
      toolName: 'customers_update',
    })

    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.code).toBe('mutation_blocked_by_readonly')
  })

  it('defaults to read-only when readOnly is not declared (v1 default blocks mutation)', () => {
    registerMcpTool(
      makeTool({ name: 'customers_update', isMutation: true }),
      { moduleId: 'customers' }
    )
    seedAgentRegistryForTests([
      makeAgent({
        id: 'customers.assistant',
        moduleId: 'customers',
        allowedTools: ['customers_update'],
      }),
    ])

    const decision = checkAgentPolicy({
      agentId: 'customers.assistant',
      authContext: { userFeatures: ['*'], isSuperAdmin: false },
      toolName: 'customers_update',
    })

    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.code).toBe('mutation_blocked_by_readonly')
  })

  it('returns mutation_blocked_by_policy when readOnly=false but mutationPolicy=read-only', () => {
    registerMcpTool(
      makeTool({ name: 'customers_update', isMutation: true }),
      { moduleId: 'customers' }
    )
    seedAgentRegistryForTests([
      makeAgent({
        id: 'customers.assistant',
        moduleId: 'customers',
        allowedTools: ['customers_update'],
        readOnly: false,
        mutationPolicy: 'read-only',
      }),
    ])

    const decision = checkAgentPolicy({
      agentId: 'customers.assistant',
      authContext: { userFeatures: ['*'], isSuperAdmin: false },
      toolName: 'customers_update',
    })

    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.code).toBe('mutation_blocked_by_policy')
  })

  it('returns execution_mode_not_supported for object requested on chat agent with no output', () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'customers.assistant',
        moduleId: 'customers',
        executionMode: 'chat',
      }),
    ])

    const decision = checkAgentPolicy({
      agentId: 'customers.assistant',
      authContext: { userFeatures: ['*'], isSuperAdmin: false },
      requestedExecutionMode: 'object',
    })

    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.code).toBe('execution_mode_not_supported')
  })

  it('returns execution_mode_not_supported for chat requested on object-mode agent', () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.merchandiser',
        moduleId: 'catalog',
        executionMode: 'object',
        output: {
          schemaName: 'MerchandisingProposal',
          schema: z.object({ proposals: z.array(z.any()) }),
        },
      }),
    ])

    const decision = checkAgentPolicy({
      agentId: 'catalog.merchandiser',
      authContext: { userFeatures: ['*'], isSuperAdmin: false },
      requestedExecutionMode: 'chat',
    })

    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.code).toBe('execution_mode_not_supported')
  })

  it('allows object-mode on chat agent when output schema is declared', () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.merchandiser',
        moduleId: 'catalog',
        executionMode: 'chat',
        output: {
          schemaName: 'MerchandisingProposal',
          schema: z.object({ proposals: z.array(z.any()) }),
        },
      }),
    ])

    const decision = checkAgentPolicy({
      agentId: 'catalog.merchandiser',
      authContext: { userFeatures: ['*'], isSuperAdmin: false },
      requestedExecutionMode: 'object',
    })

    expect(decision.ok).toBe(true)
  })

  it('returns attachment_type_not_accepted when agent has no acceptedMediaTypes but images are sent', () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'customers.assistant',
        moduleId: 'customers',
      }),
    ])

    const decision = checkAgentPolicy({
      agentId: 'customers.assistant',
      authContext: { userFeatures: ['*'], isSuperAdmin: false },
      attachmentMediaTypes: ['image/png'],
    })

    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.code).toBe('attachment_type_not_accepted')
  })

  it('returns attachment_type_not_accepted when agent accepts [image] but a PDF is requested', () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.merchandiser',
        moduleId: 'catalog',
        acceptedMediaTypes: ['image'],
      }),
    ])

    const decision = checkAgentPolicy({
      agentId: 'catalog.merchandiser',
      authContext: { userFeatures: ['*'], isSuperAdmin: false },
      attachmentMediaTypes: ['image/jpeg', 'application/pdf'],
    })

    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.code).toBe('attachment_type_not_accepted')
  })

  it('allows attachments that match the declared acceptedMediaTypes', () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.merchandiser',
        moduleId: 'catalog',
        acceptedMediaTypes: ['image', 'pdf'],
      }),
    ])

    const decision = checkAgentPolicy({
      agentId: 'catalog.merchandiser',
      authContext: { userFeatures: ['*'], isSuperAdmin: false },
      attachmentMediaTypes: ['image/png', 'application/pdf'],
    })

    expect(decision.ok).toBe(true)
  })

  it('success path returns the resolved agent and tool when toolName is provided', () => {
    const tool = makeTool({ name: 'customers_search' })
    registerMcpTool(tool, { moduleId: 'customers' })
    const agent = makeAgent({
      id: 'customers.assistant',
      moduleId: 'customers',
      allowedTools: ['customers_search'],
    })
    seedAgentRegistryForTests([agent])

    const decision = checkAgentPolicy({
      agentId: 'customers.assistant',
      authContext: { userFeatures: ['*'], isSuperAdmin: false },
      toolName: 'customers_search',
    })

    expect(decision.ok).toBe(true)
    if (decision.ok) {
      expect(decision.agent).toBe(agent)
      expect(decision.tool?.name).toBe('customers_search')
    }
  })

  it('success path when toolName is omitted (session-establish check)', () => {
    const agent = makeAgent({
      id: 'customers.assistant',
      moduleId: 'customers',
    })
    seedAgentRegistryForTests([agent])

    const decision = checkAgentPolicy({
      agentId: 'customers.assistant',
      authContext: { userFeatures: ['*'], isSuperAdmin: false },
    })

    expect(decision.ok).toBe(true)
    if (decision.ok) {
      expect(decision.agent).toBe(agent)
      expect(decision.tool).toBeUndefined()
    }
  })
})
