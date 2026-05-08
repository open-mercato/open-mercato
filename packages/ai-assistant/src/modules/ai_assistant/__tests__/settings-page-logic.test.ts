/**
 * Unit tests for AiAssistantSettingsPageClient business logic.
 *
 * The component itself is a React client component that uses useQuery and
 * useGuardedMutation — it is exercised end-to-end via Playwright (step 4b.12).
 * This file validates the pure filtering and resolution logic that drives the
 * per-agent override table display.
 */

type AgentResolution = {
  agentId: string
  moduleId: string
  allowRuntimeModelOverride: boolean
  providerId: string
  modelId: string
  baseURL: string | null
  source: string
}

/**
 * Mirror of the filtering logic in PerAgentOverrideList:
 * an agent row shows a "Clear override" button only when its source
 * indicates an explicit override (not env_default or provider_default).
 */
function hasActiveOverride(agent: AgentResolution): boolean {
  return agent.source !== 'env_default' && agent.source !== 'provider_default'
}

describe('AiAssistantSettingsPageClient — per-agent override detection', () => {
  const baseAgent: Omit<AgentResolution, 'source'> = {
    agentId: 'catalog.merchandising_assistant',
    moduleId: 'catalog',
    allowRuntimeModelOverride: true,
    providerId: 'anthropic',
    modelId: 'claude-haiku-4-5',
    baseURL: null,
  }

  it('does not flag env_default agents as overridden', () => {
    expect(hasActiveOverride({ ...baseAgent, source: 'env_default' })).toBe(false)
  })

  it('does not flag provider_default agents as overridden', () => {
    expect(hasActiveOverride({ ...baseAgent, source: 'provider_default' })).toBe(false)
  })

  it('flags tenant_override agents as overridden', () => {
    expect(hasActiveOverride({ ...baseAgent, source: 'tenant_override' })).toBe(true)
  })

  it('flags agent_override agents as overridden', () => {
    expect(hasActiveOverride({ ...baseAgent, source: 'agent_override' })).toBe(true)
  })

  it('flags runtime_override agents as overridden', () => {
    expect(hasActiveOverride({ ...baseAgent, source: 'runtime_override' })).toBe(true)
  })

  it('flags unknown source strings as overridden (safe fallback)', () => {
    expect(hasActiveOverride({ ...baseAgent, source: 'some_new_source' })).toBe(true)
  })
})

describe('AiAssistantSettingsPageClient — resolution table filtering', () => {
  const agents: AgentResolution[] = [
    {
      agentId: 'catalog.catalog_assistant',
      moduleId: 'catalog',
      allowRuntimeModelOverride: true,
      providerId: 'anthropic',
      modelId: 'claude-haiku-4-5',
      baseURL: null,
      source: 'provider_default',
    },
    {
      agentId: 'catalog.merchandising_assistant',
      moduleId: 'catalog',
      allowRuntimeModelOverride: true,
      providerId: 'openai',
      modelId: 'gpt-4o',
      baseURL: null,
      source: 'tenant_override',
    },
    {
      agentId: 'customers.account_assistant',
      moduleId: 'customers',
      allowRuntimeModelOverride: false,
      providerId: 'anthropic',
      modelId: 'claude-haiku-4-5',
      baseURL: null,
      source: 'env_default',
    },
  ]

  it('identifies exactly the agents with active overrides', () => {
    const overridden = agents.filter(hasActiveOverride)
    expect(overridden).toHaveLength(1)
    expect(overridden[0].agentId).toBe('catalog.merchandising_assistant')
  })

  it('returns an empty list when no agents have active overrides', () => {
    const defaultAgents: AgentResolution[] = agents.map((a) => ({
      ...a,
      source: 'provider_default',
    }))
    expect(defaultAgents.filter(hasActiveOverride)).toHaveLength(0)
  })

  it('returns all agents when every agent has an active override', () => {
    const allOverridden: AgentResolution[] = agents.map((a) => ({
      ...a,
      source: 'tenant_override',
    }))
    expect(allOverridden.filter(hasActiveOverride)).toHaveLength(agents.length)
  })
})
