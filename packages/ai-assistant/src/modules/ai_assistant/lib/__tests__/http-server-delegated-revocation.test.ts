import type { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { McpToolContext } from '../types'
import { createMcpServerForRequest } from '../http-server'

const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>()
const mockExecuteTool = jest.fn()
const mockSessionKey = jest.fn()

jest.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {
    registerTool(name: string, _options: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) {
      handlers.set(name, handler)
    }
  },
}))
jest.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({ StreamableHTTPServerTransport: class {} }))
jest.mock('../tool-registry', () => ({
  getToolRegistry: () => ({ getTools: () => new Map([['test-tool', { name: 'test-tool', description: 'Test tool' }]]) }),
}))
jest.mock('../tool-executor', () => ({ executeTool: (...args: unknown[]) => mockExecuteTool(...args) }))
jest.mock('../tool-loader', () => ({ loadAllModuleTools: jest.fn(), indexToolsForSearch: jest.fn() }))
jest.mock('../auth', () => ({ hasRequiredFeatures: () => true }))
jest.mock('@open-mercato/core/modules/api_keys/services/apiKeyService', () => ({
  findApiKeyBySecret: jest.fn(),
  findSessionApiKeyWithSecret: (...args: unknown[]) => mockSessionKey(...args),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (manager: { findOne: (...args: unknown[]) => Promise<unknown> }, ...args: unknown[]) => manager.findOne(...args),
}))

describe('MCP delegated credential revocation', () => {
  beforeEach(() => {
    handlers.clear()
    mockExecuteTool.mockReset().mockResolvedValue({ success: true, result: { ok: true } })
    mockSessionKey.mockReset()
  })

  it('preserves independent machine-key execution without the creator session policy', async () => {
    const isUserSessionEligible = jest.fn().mockResolvedValue(false)
    const loadAcl = jest.fn().mockResolvedValue({ features: [], isSuperAdmin: false })
    const context = {
      userId: 'creator-1', tenantId: 'tenant-1', organizationId: 'org-1', userFeatures: [], isSuperAdmin: false,
      container: { resolve: (name: string) => name === 'authService' ? { isUserSessionEligible } : { loadAcl } },
    } as unknown as McpToolContext
    createMcpServerForRequest({ name: 'test', version: '1' }, context, {
      id: 'machine-key', createdBy: 'creator-1', tenantId: 'tenant-1', organizationId: 'org-1',
    } as ApiKey)

    await handlers.get('test-tool')!({})

    expect(mockExecuteTool).toHaveBeenCalledTimes(1)
    expect(isUserSessionEligible).not.toHaveBeenCalled()
  })

  it.each(['header', 'session'])('keeps an old %s credential dead after deactivation and reactivation even when its context holds the old row', async (mode) => {
    let deactivated = false
    let keyAlive = true
    const key = { id: 'key-1', sessionUserId: 'user-1', createdBy: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' } as ApiKey
    const findOne = jest.fn(async (_entity: unknown, where: Record<string, unknown>) => (
      keyAlive && where.id === key.id && where.sessionUserId === key.sessionUserId
        && where.tenantId === key.tenantId && where.organizationId === key.organizationId
        ? { id: key.id } : null
    ))
    const auth = new AuthService({ findOne } as unknown as EntityManager)
    const isUserSessionEligible = jest.fn(async (scope: Parameters<AuthService['isUserSessionEligible']>[0]) => !deactivated && auth.isUserSessionEligible(scope))
    const loadAcl = jest.fn().mockResolvedValue({ features: [], isSuperAdmin: false })
    const context = {
      userId: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1', userFeatures: [], isSuperAdmin: false,
      container: { resolve: (name: string) => name === 'authService' ? { isUserSessionEligible } : name === 'rbacService' ? { loadAcl } : {} },
    } as unknown as McpToolContext
    mockSessionKey.mockResolvedValue({ key, secret: 'delegated-secret' })
    createMcpServerForRequest({ name: 'test', version: '1' }, context, key)
    const invoke = () => handlers.get('test-tool')!(mode === 'session' ? { _sessionToken: 'sess_old' } : {})

    await invoke()
    expect(mockExecuteTool).toHaveBeenCalledTimes(1)
    deactivated = true
    keyAlive = false
    expect(await invoke()).toMatchObject({ isError: true })
    deactivated = false
    expect(await invoke()).toMatchObject({ isError: true })

    expect(mockExecuteTool).toHaveBeenCalledTimes(1)
    expect(loadAcl).toHaveBeenCalledTimes(1)
    expect(isUserSessionEligible).toHaveBeenLastCalledWith({ userId: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1', apiKeyId: 'key-1' })
    expect(findOne).toHaveBeenLastCalledWith(expect.any(Function), expect.objectContaining({ id: 'key-1', sessionUserId: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1', deletedAt: null, $or: [{ expiresAt: null }, { expiresAt: { $gt: expect.any(Date) } }] }), expect.objectContaining({ fields: ['id'], refresh: true }), { tenantId: 'tenant-1', organizationId: 'org-1' })
  })
})
