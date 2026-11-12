import type { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import type { McpServerConfig, McpToolContext } from '../types'

type RegisteredTool = {
  handler: (args: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>
}

const registeredTools: Record<string, RegisteredTool> = {}

jest.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {
    registerTool(name: string, _config: unknown, handler: RegisteredTool['handler']) {
      registeredTools[name] = { handler }
    }
  },
}))

jest.mock('../tool-registry', () => ({
  getToolRegistry: () => ({
    getTools: () =>
      new Map([
        [
          'test.tool',
          {
            name: 'test.tool',
            description: 'A tool that requires a feature',
            inputSchema: undefined,
            requiredFeatures: ['test.feature'],
          },
        ],
      ]),
  }),
}))

jest.mock('../tool-executor', () => ({
  executeTool: jest.fn(async () => ({ success: true, data: { ok: true } })),
}))

jest.mock('../tool-loader', () => ({
  loadAllModuleTools: jest.fn(),
  indexToolsForSearch: jest.fn(),
}))

jest.mock('../auth', () => ({
  authenticateMcpRequest: jest.fn(),
  extractApiKeyFromHeaders: jest.fn(),
  hasRequiredFeatures: jest.fn(() => true),
}))

const findSessionApiKeyWithSecret = jest.fn()
jest.mock('@open-mercato/core/modules/api_keys/services/apiKeyService', () => ({
  findApiKeyBySecret: jest.fn(),
  findSessionApiKeyWithSecret: (...args: unknown[]) => findSessionApiKeyWithSecret(...args),
}))

import { createMcpServerForRequest } from '../http-server'

const SUPERADMIN_ACL = { isSuperAdmin: true, features: ['*'] }
const loadAcl = jest.fn()

function makeToolContext(): McpToolContext {
  return {
    tenantId: null,
    organizationId: null,
    userId: null,
    container: {
      resolve: (name: string) => {
        if (name === 'rbacService') return { loadAcl }
        if (name === 'em') return {}
        return {}
      },
    } as unknown as McpToolContext['container'],
    userFeatures: [],
    isSuperAdmin: false,
  }
}

function makeApiKeyRecord(): ApiKey {
  return {
    id: 'infra-key-1',
    createdBy: 'superadmin-user-1',
    sessionUserId: null,
    tenantId: null,
    organizationId: null,
  } as unknown as ApiKey
}

async function callTool(args: Record<string, unknown>) {
  return registeredTools['test.tool']!.handler(args)
}

describe('issue #5173 — MCP HTTP server must fail closed without a session token', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    loadAcl.mockResolvedValue(SUPERADMIN_ACL)
  })

  function register(config: McpServerConfig) {
    for (const key of Object.keys(registeredTools)) delete registeredTools[key]
    createMcpServerForRequest(config, makeToolContext(), makeApiKeyRecord())
  }

  it('returns UNAUTHORIZED and never grants the transport key ACL when _sessionToken is missing (default config)', async () => {
    register({ name: 'test', version: '0.0.0' })

    const result = await callTool({})

    expect(result.isError).toBe(true)
    const payload = JSON.parse(result.content[0]!.text)
    expect(payload.code).toBe('UNAUTHORIZED')
    expect(loadAcl).not.toHaveBeenCalled()
  })

  it('still fails closed when allowApiKeyFallback is explicitly false', async () => {
    register({ name: 'test', version: '0.0.0', allowApiKeyFallback: false })

    const result = await callTool({})

    expect(result.isError).toBe(true)
    expect(loadAcl).not.toHaveBeenCalled()
  })

  it('preserves the legacy fallback only when allowApiKeyFallback is explicitly enabled', async () => {
    register({ name: 'test', version: '0.0.0', allowApiKeyFallback: true })

    const result = await callTool({})

    expect(result.isError).toBeUndefined()
    expect(loadAcl).toHaveBeenCalledWith('api_key:infra-key-1', { tenantId: null, organizationId: null })
  })

  it('resolves per-user session identity normally regardless of allowApiKeyFallback', async () => {
    findSessionApiKeyWithSecret.mockResolvedValue({
      key: { id: 'session-1', sessionUserId: 'employee-1', createdBy: 'employee-1', tenantId: 't1', organizationId: 'o1' },
      secret: 'sess_secret',
    })
    loadAcl.mockResolvedValue({ isSuperAdmin: false, features: ['test.feature'] })

    register({ name: 'test', version: '0.0.0' })

    const result = await callTool({ _sessionToken: 'sess_abc123' })

    expect(result.isError).toBeUndefined()
    expect(loadAcl).toHaveBeenCalledWith('api_key:session-1', { tenantId: 't1', organizationId: 'o1' })
  })
})
