import { z } from 'zod'

const authMock = jest.fn()
const loadAclMock = jest.fn()
const filterRunnableAgentToolsMock = jest.fn()
const registeredTools = new Map<string, Record<string, unknown>>()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => authMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (name: string) => {
      if (name === 'rbacService') return { loadAcl: loadAclMock }
      return undefined
    },
  })),
}))

jest.mock('../../../lib/tool-loader', () => ({
  loadAllModuleTools: jest.fn(async () => undefined),
}))

jest.mock('../../../lib/tool-registry', () => ({
  getToolRegistry: () => ({ getTools: () => registeredTools }),
}))

jest.mock('../../../lib/mcp-agent-tool-results', () => ({
  filterRunnableAgentTools: (...args: unknown[]) => filterRunnableAgentToolsMock(...args),
}))

import { GET } from '../route'

const ENV_KEYS = ['OM_MCP_TOOL_ALLOWLIST', 'OM_MCP_TOOL_DENYLIST', 'OM_MCP_MUTATION_MODE', 'OM_MCP_AGENT_TOOLS'] as const

function registerTool(name: string, extra: Record<string, unknown> = {}) {
  registeredTools.set(name, {
    name,
    description: `${name} description`,
    inputSchema: z.object({ query: z.string().optional() }),
    handler: jest.fn(),
    ...extra,
  })
}

function buildRequest(query = '') {
  return new Request(`http://localhost/api/ai_assistant/tools${query}`) as unknown as Parameters<typeof GET>[0]
}

type ExposureTool = {
  name: string
  module: string
  exposed: boolean
  hiddenReason: string | null
  isMutation: boolean
  agentRef: { agentId: string; engine: string } | null
}

async function readExposure(query = '?view=mcp') {
  const response = await GET(buildRequest(query))
  expect(response.status).toBe(200)
  const body = (await response.json()) as {
    mutationMode: string
    allowlist: string[] | null
    denylist: string[]
    agentToolsEnabled: boolean
    tools: ExposureTool[]
  }
  return { body, byName: new Map(body.tools.map((tool) => [tool.name, tool])) }
}

describe('GET /api/ai_assistant/tools', () => {
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    jest.clearAllMocks()
    registeredTools.clear()
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
    authMock.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    loadAclMock.mockResolvedValue({ features: ['customers.*', 'ai_assistant.view'], isSuperAdmin: false })
    filterRunnableAgentToolsMock.mockImplementation(async (tools: unknown[]) => tools)
    registerTool('customers.list_people', { requiredFeatures: ['customers.people.view'] })
    registerTool('customers.update_person', { requiredFeatures: ['customers.people.manage'], isMutation: true })
    registerTool('customers.hidden_helper', { requiredFeatures: ['customers.people.view'], mcp: { expose: false } })
    registerTool('catalog.list_products', { requiredFeatures: ['catalog.products.view'] })
    registerTool('customers.account_assistant.run', {
      requiredFeatures: ['customers.people.view'],
      agentRef: { agentId: 'customers.account_assistant', engine: 'ai-assistant' },
    })
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
  })

  it('keeps the default response shape when no view is requested', async () => {
    const response = await GET(buildRequest())
    expect(response.status).toBe(200)
    const body = (await response.json()) as { tools: Array<Record<string, unknown>> }
    expect(Object.keys(body)).toEqual(['tools'])
    expect(body.tools.map((tool) => tool.name)).toEqual([
      'customers.list_people',
      'customers.update_person',
      'customers.hidden_helper',
      'customers.account_assistant.run',
    ])
    expect(Object.keys(body.tools[0]).sort()).toEqual(['description', 'inputSchema', 'module', 'name'])
    expect(filterRunnableAgentToolsMock).not.toHaveBeenCalled()
  })

  it('rejects an unknown view with 400', async () => {
    const response = await GET(buildRequest('?view=other'))
    expect(response.status).toBe(400)
  })

  it('returns 401 without auth', async () => {
    authMock.mockResolvedValue(null)
    const response = await GET(buildRequest('?view=mcp'))
    expect(response.status).toBe(401)
  })

  it('reports the default exposure config and filters tools by the caller ACL', async () => {
    const { body, byName } = await readExposure()
    expect(body).toMatchObject({ mutationMode: 'direct', allowlist: null, denylist: [], agentToolsEnabled: true })
    expect(byName.has('catalog.list_products')).toBe(false)
    expect(byName.get('customers.list_people')).toEqual({
      name: 'customers.list_people',
      module: 'customers',
      exposed: true,
      hiddenReason: null,
      isMutation: false,
      agentRef: null,
    })
    expect(byName.get('customers.hidden_helper')).toMatchObject({ exposed: false, hiddenReason: 'expose_false' })
    expect(byName.get('customers.account_assistant.run')).toMatchObject({
      exposed: true,
      agentRef: { agentId: 'customers.account_assistant', engine: 'ai-assistant' },
    })
  })

  it('reports allowlist, denylist and mutation-mode reasons from env', async () => {
    process.env.OM_MCP_TOOL_ALLOWLIST = 'customers.*'
    process.env.OM_MCP_TOOL_DENYLIST = 'customers.list_people'
    process.env.OM_MCP_MUTATION_MODE = 'deny'
    loadAclMock.mockResolvedValue({ features: [], isSuperAdmin: true })
    const { body, byName } = await readExposure()
    expect(body).toMatchObject({ mutationMode: 'deny', allowlist: ['customers.*'], denylist: ['customers.list_people'] })
    expect(byName.get('catalog.list_products')).toMatchObject({ exposed: false, hiddenReason: 'not_allowlisted' })
    expect(byName.get('customers.list_people')).toMatchObject({ exposed: false, hiddenReason: 'denylist' })
    expect(byName.get('customers.update_person')).toMatchObject({
      exposed: false,
      hiddenReason: 'mutation_mode',
      isMutation: true,
    })
  })

  it('reports agent_tools_off when agent tools are disabled', async () => {
    process.env.OM_MCP_AGENT_TOOLS = 'off'
    const { body, byName } = await readExposure()
    expect(body.agentToolsEnabled).toBe(false)
    expect(byName.get('customers.account_assistant.run')).toMatchObject({
      exposed: false,
      hiddenReason: 'agent_tools_off',
    })
    expect(byName.get('customers.list_people')).toMatchObject({ exposed: true })
  })

  it('reports agent_unavailable when the agent behind an exposed agent tool cannot run', async () => {
    filterRunnableAgentToolsMock.mockResolvedValue([])
    const { byName } = await readExposure()
    expect(filterRunnableAgentToolsMock).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'customers.account_assistant.run' })],
      expect.anything(),
    )
    expect(byName.get('customers.account_assistant.run')).toMatchObject({
      exposed: false,
      hiddenReason: 'agent_unavailable',
    })
  })
})
