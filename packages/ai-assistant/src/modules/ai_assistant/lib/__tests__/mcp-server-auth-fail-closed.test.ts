import { createMcpServer } from '../mcp-server'
import type { McpServerOptions } from '../types'

jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: class {
    setRequestHandler() {}
  },
}))
jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {},
}))
jest.mock('@modelcontextprotocol/sdk/types.js', () => ({
  ListToolsRequestSchema: {},
  CallToolRequestSchema: {},
}))
jest.mock('../tool-registry', () => ({
  getToolRegistry: () => ({
    getTools: () => new Map(),
    listToolNames: () => [],
  }),
}))
jest.mock('../tool-executor', () => ({ executeTool: jest.fn() }))
jest.mock('../tool-loader', () => ({
  loadAllModuleTools: jest.fn(),
  indexToolsForSearch: jest.fn(),
}))

const authenticateMcpRequest = jest.fn()
jest.mock('../auth', () => ({
  authenticateMcpRequest: (...args: unknown[]) => authenticateMcpRequest(...args),
  hasRequiredFeatures: jest.fn(() => true),
}))

const loadAcl = jest.fn()

function makeContainer() {
  return {
    resolve: (name: string) => {
      if (name === 'rbacService') return { loadAcl }
      return {}
    },
  } as unknown as McpServerOptions['container']
}

function baseOptions(overrides: Partial<McpServerOptions>): McpServerOptions {
  return {
    config: { name: 'test-mcp', version: '0.0.0', debug: false },
    container: makeContainer(),
    ...overrides,
  } as McpServerOptions
}

describe('issue #2673 — MCP stdio server must fail closed without auth', () => {
  beforeEach(() => {
    authenticateMcpRequest.mockReset()
    loadAcl.mockReset()
    loadAcl.mockResolvedValue({ isSuperAdmin: false, features: ['ai_assistant.view'] })
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('throws when neither apiKeySecret nor context is supplied', async () => {
    await expect(createMcpServer(baseOptions({}))).rejects.toThrow(
      /refused to start: no authentication/i,
    )
    expect(loadAcl).not.toHaveBeenCalled()
  })

  it('throws when context lacks a userId (the mcp:serve --tenant-without-user path)', async () => {
    await expect(
      createMcpServer(
        baseOptions({ context: { tenantId: 't1', organizationId: 'o1', userId: null } }),
      ),
    ).rejects.toThrow(/refused to start: no authentication/i)
    expect(loadAcl).not.toHaveBeenCalled()
  })

  it('treats an empty-string apiKeySecret as missing and fails closed', async () => {
    await expect(createMcpServer(baseOptions({ apiKeySecret: '' }))).rejects.toThrow(
      /refused to start: no authentication/i,
    )
    expect(authenticateMcpRequest).not.toHaveBeenCalled()
  })

  it('treats a whitespace-only apiKeySecret as missing and fails closed', async () => {
    await expect(createMcpServer(baseOptions({ apiKeySecret: '   ' }))).rejects.toThrow(
      /refused to start: no authentication/i,
    )
    expect(authenticateMcpRequest).not.toHaveBeenCalled()
  })

  it('loads the real user ACL when context carries a non-empty userId', async () => {
    const server = await createMcpServer(
      baseOptions({ context: { tenantId: 't1', organizationId: 'o1', userId: 'u1' } }),
    )
    expect(server).toBeDefined()
    expect(loadAcl).toHaveBeenCalledWith('u1', { tenantId: 't1', organizationId: 'o1' })
  })

  it('allows unauthenticated superadmin only behind the explicit opt-in, without loading an ACL', async () => {
    const server = await createMcpServer(
      baseOptions({
        context: { tenantId: 't1', organizationId: 'o1', userId: null },
        allowUnauthenticatedSuperadmin: true,
      }),
    )
    expect(server).toBeDefined()
    expect(loadAcl).not.toHaveBeenCalled()
  })

  it('allows fully unauthenticated superadmin behind the opt-in with no context', async () => {
    const server = await createMcpServer(baseOptions({ allowUnauthenticatedSuperadmin: true }))
    expect(server).toBeDefined()
  })

  it('still authenticates via a valid apiKeySecret', async () => {
    authenticateMcpRequest.mockResolvedValue({
      success: true,
      tenantId: 't1',
      organizationId: 'o1',
      userId: 'u1',
      features: ['ai_assistant.view'],
      isSuperAdmin: false,
      keyName: 'test-key',
    })
    const server = await createMcpServer(baseOptions({ apiKeySecret: 'omk_valid.secret' }))
    expect(server).toBeDefined()
    expect(authenticateMcpRequest).toHaveBeenCalledWith('omk_valid.secret', expect.anything())
  })
})
