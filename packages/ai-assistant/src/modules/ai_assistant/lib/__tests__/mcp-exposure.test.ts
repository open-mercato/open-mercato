import {
  filterToolsForCaller,
  isToolExposed,
  matchesToolPattern,
  resolveMcpExposureConfig,
  type McpExposableTool,
  type McpExposureConfig,
} from '../mcp-exposure'

type TestTool = McpExposableTool & {
  mcp?: { expose?: boolean }
  agentRef?: string
}

const baseConfig: McpExposureConfig = {
  allow: null,
  deny: [],
  mutationMode: 'direct',
  includeAgentTools: true,
}

function tool(name: string, extra: Partial<TestTool> = {}): TestTool {
  return { name, ...extra }
}

function names(tools: McpExposableTool[]): string[] {
  return tools.map((entry) => entry.name)
}

describe('resolveMcpExposureConfig', () => {
  it('returns defaults when nothing is set', () => {
    expect(resolveMcpExposureConfig({}, {})).toEqual(baseConfig)
  })

  it('reads env values', () => {
    const config = resolveMcpExposureConfig(
      {
        OM_MCP_TOOL_ALLOWLIST: 'customers.*, search ,execute',
        OM_MCP_TOOL_DENYLIST: 'customers.delete_person',
        OM_MCP_MUTATION_MODE: 'approval',
        OM_MCP_AGENT_TOOLS: 'off',
      },
      {},
    )
    expect(config).toEqual({
      allow: ['customers.*', 'search', 'execute'],
      deny: ['customers.delete_person'],
      mutationMode: 'approval',
      includeAgentTools: false,
    })
  })

  it('prefers CLI args over env', () => {
    const config = resolveMcpExposureConfig(
      {
        OM_MCP_TOOL_ALLOWLIST: 'customers.*',
        OM_MCP_TOOL_DENYLIST: 'customers.delete_person',
        OM_MCP_MUTATION_MODE: 'approval',
        OM_MCP_AGENT_TOOLS: 'on',
      },
      {
        tools: 'catalog.*',
        'exclude-tools': 'catalog.delete_product',
        'mutation-mode': 'deny',
        'no-agent-tools': true,
      },
    )
    expect(config).toEqual({
      allow: ['catalog.*'],
      deny: ['catalog.delete_product'],
      mutationMode: 'deny',
      includeAgentTools: false,
    })
  })

  it('accepts camelCase CLI keys', () => {
    const config = resolveMcpExposureConfig(
      {},
      { excludeTools: 'search', mutationMode: 'approval', noAgentTools: 'true' },
    )
    expect(config.deny).toEqual(['search'])
    expect(config.mutationMode).toBe('approval')
    expect(config.includeAgentTools).toBe(false)
  })

  it('lets an explicit CLI no-agent-tools=false re-enable agent tools', () => {
    const config = resolveMcpExposureConfig({ OM_MCP_AGENT_TOOLS: 'off' }, { 'no-agent-tools': 'false' })
    expect(config.includeAgentTools).toBe(true)
  })

  it('treats blank env lists as unset', () => {
    const config = resolveMcpExposureConfig({ OM_MCP_TOOL_ALLOWLIST: '  ', OM_MCP_TOOL_DENYLIST: '' }, {})
    expect(config.allow).toBeNull()
    expect(config.deny).toEqual([])
  })

  it('treats an explicit empty CLI tools value as an empty allowlist', () => {
    const config = resolveMcpExposureConfig({ OM_MCP_TOOL_ALLOWLIST: 'customers.*' }, { tools: '' })
    expect(config.allow).toEqual([])
  })

  it('falls back to direct for unknown mutation modes', () => {
    expect(resolveMcpExposureConfig({ OM_MCP_MUTATION_MODE: 'yolo' }, {}).mutationMode).toBe('direct')
    expect(
      resolveMcpExposureConfig({ OM_MCP_MUTATION_MODE: 'deny' }, { 'mutation-mode': 'nope' }).mutationMode,
    ).toBe('direct')
  })

  it('normalizes mutation mode case', () => {
    expect(resolveMcpExposureConfig({ OM_MCP_MUTATION_MODE: ' DENY ' }, {}).mutationMode).toBe('deny')
  })
})

describe('matchesToolPattern', () => {
  it('matches exact names and trailing globs', () => {
    expect(matchesToolPattern('customers.list_people', 'customers.list_people')).toBe(true)
    expect(matchesToolPattern('customers.list_people', 'customers.*')).toBe(true)
    expect(matchesToolPattern('catalog.list_products', 'customers.*')).toBe(false)
    expect(matchesToolPattern('customers.list_people', 'customers.list')).toBe(false)
    expect(matchesToolPattern('anything', '*')).toBe(true)
  })
})

describe('isToolExposed', () => {
  it('exposes everything with default config', () => {
    expect(isToolExposed(tool('customers.list_people'), baseConfig)).toBe(true)
  })

  it('hides tools that opt out via mcp.expose = false', () => {
    expect(isToolExposed(tool('customers.list_people', { mcp: { expose: false } }), baseConfig)).toBe(false)
    expect(isToolExposed(tool('customers.list_people', { mcp: { expose: true } }), baseConfig)).toBe(true)
    expect(isToolExposed(tool('customers.list_people', { mcp: {} }), baseConfig)).toBe(true)
  })

  it('applies the allowlist with globs', () => {
    const config = { ...baseConfig, allow: ['customers.*', 'catalog.list_products'] }
    expect(isToolExposed(tool('customers.list_people'), config)).toBe(true)
    expect(isToolExposed(tool('catalog.list_products'), config)).toBe(true)
    expect(isToolExposed(tool('catalog.update_product'), config)).toBe(false)
  })

  it('hides everything with an empty allowlist', () => {
    const config = { ...baseConfig, allow: [] }
    expect(isToolExposed(tool('customers.list_people'), config)).toBe(false)
    expect(isToolExposed(tool('search'), config)).toBe(false)
  })

  it('applies the denylist after the allowlist', () => {
    const config = { ...baseConfig, allow: ['customers.*'], deny: ['customers.delete_*'] }
    expect(isToolExposed(tool('customers.list_people'), config)).toBe(true)
    expect(isToolExposed(tool('customers.delete_person'), config)).toBe(false)
  })

  it('hides mutations only in deny mutation mode', () => {
    const mutation = tool('customers.update_person', { isMutation: true })
    const read = tool('customers.list_people', { isMutation: false })
    expect(isToolExposed(mutation, { ...baseConfig, mutationMode: 'deny' })).toBe(false)
    expect(isToolExposed(read, { ...baseConfig, mutationMode: 'deny' })).toBe(true)
    expect(isToolExposed(mutation, { ...baseConfig, mutationMode: 'direct' })).toBe(true)
    expect(isToolExposed(mutation, { ...baseConfig, mutationMode: 'approval' })).toBe(true)
  })

  it('hides agent tools when includeAgentTools is false', () => {
    const agentTool = tool('agent.customers.account_assistant', { agentRef: 'customers.account_assistant' })
    expect(isToolExposed(agentTool, baseConfig)).toBe(true)
    expect(isToolExposed(agentTool, { ...baseConfig, includeAgentTools: false })).toBe(false)
    expect(isToolExposed(tool('customers.list_people'), { ...baseConfig, includeAgentTools: false })).toBe(true)
  })

  it('matches Code Mode tool names like any other tool', () => {
    const config = { ...baseConfig, allow: ['customers.*', 'search'] }
    expect(isToolExposed(tool('search'), config)).toBe(true)
    expect(isToolExposed(tool('execute'), config)).toBe(false)
    expect(isToolExposed(tool('context_whoami'), config)).toBe(false)
    expect(isToolExposed(tool('execute'), { ...baseConfig, deny: ['execute'] })).toBe(false)
  })
})

describe('filterToolsForCaller', () => {
  const tools: TestTool[] = [
    tool('customers.list_people', { requiredFeatures: ['customers.people.view'] }),
    tool('customers.update_person', { requiredFeatures: ['customers.people.manage'], isMutation: true }),
    tool('catalog.list_products', { requiredFeatures: ['catalog.products.view'] }),
    tool('context_whoami'),
  ]

  it('filters by caller features', () => {
    const result = filterToolsForCaller(tools, baseConfig, {
      features: ['customers.people.view'],
      isSuperAdmin: false,
    })
    expect(names(result)).toEqual(['customers.list_people', 'context_whoami'])
  })

  it('honours wildcard features', () => {
    const result = filterToolsForCaller(tools, baseConfig, { features: ['customers.*'], isSuperAdmin: false })
    expect(names(result)).toEqual(['customers.list_people', 'customers.update_person', 'context_whoami'])
  })

  it('lets superadmins see every exposed tool', () => {
    const result = filterToolsForCaller(tools, { ...baseConfig, mutationMode: 'deny' }, {
      features: [],
      isSuperAdmin: true,
    })
    expect(names(result)).toEqual(['customers.list_people', 'catalog.list_products', 'context_whoami'])
  })

  it('combines exposure config with caller features', () => {
    const result = filterToolsForCaller(tools, { ...baseConfig, allow: ['catalog.*', 'customers.*'] }, {
      features: ['catalog.*'],
      isSuperAdmin: false,
    })
    expect(names(result)).toEqual(['catalog.list_products'])
  })
})
