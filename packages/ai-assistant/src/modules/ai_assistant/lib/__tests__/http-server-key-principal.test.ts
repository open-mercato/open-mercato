import type { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import type { McpToolContext } from '../types'

const findSessionApiKeyWithSecret = jest.fn()
const resolveVerifiedSessionKeyUserId = jest.fn()
const loadAcl = jest.fn()

jest.mock('@open-mercato/core/modules/api_keys/services/apiKeyService', () => ({
  findApiKeyBySecret: jest.fn(),
  findSessionApiKeyWithSecret: (...args: unknown[]) => findSessionApiKeyWithSecret(...args),
}))
jest.mock('@open-mercato/core/modules/api_keys/services/sessionKeyRoles', () => ({
  resolveVerifiedSessionKeyUserId: (...args: unknown[]) => resolveVerifiedSessionKeyUserId(...args),
}))
jest.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({ McpServer: class {} }))
jest.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({ StreamableHTTPServerTransport: class {} }))
jest.mock('../tool-registry', () => ({ getToolRegistry: jest.fn() }))
jest.mock('../tool-executor', () => ({ executeTool: jest.fn() }))
jest.mock('../tool-loader', () => ({ loadAllModuleTools: jest.fn(), indexToolsForSearch: jest.fn() }))

import { resolveApiKeyContext, resolveSessionContext } from '../http-server'

const em = { name: 'mcp-http-em' }
const baseContext = {
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  userId: 'creator-1',
  container: { resolve: (name: string) => (name === 'em' ? em : name === 'rbacService' ? { loadAcl } : undefined) },
  userFeatures: [],
  isSuperAdmin: false,
  apiKeySecret: 'omk_server.secret',
  apiKeyId: 'server-key',
} as unknown as McpToolContext

const sessionKey = {
  id: 'session-key-1', tenantId: 'tenant-1', organizationId: 'org-1', sessionUserId: 'user-1', createdBy: 'user-1',
} as unknown as ApiKey

describe('HTTP MCP server key principal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    loadAcl.mockResolvedValue({ isSuperAdmin: false, features: ['attachments.view'], organizations: null })
  })

  it('carries the session key id and its verified user into the tool context', async () => {
    findSessionApiKeyWithSecret.mockResolvedValue({ key: sessionKey, secret: 'omk_session.secret' })
    resolveVerifiedSessionKeyUserId.mockResolvedValue('user-1')

    const context = await resolveSessionContext('sess_token', baseContext)

    expect(loadAcl).toHaveBeenCalledWith('api_key:session-key-1', { tenantId: 'tenant-1', organizationId: 'org-1' })
    expect(resolveVerifiedSessionKeyUserId).toHaveBeenCalledWith(em, sessionKey)
    expect(context).toMatchObject({ apiKeyId: 'session-key-1', apiKeyUserId: 'user-1', apiKeySecret: 'omk_session.secret' })
  })

  it('leaves the session user out when verification fails, so the key is evaluated alone', async () => {
    findSessionApiKeyWithSecret.mockResolvedValue({ key: sessionKey, secret: 'omk_session.secret' })
    resolveVerifiedSessionKeyUserId.mockResolvedValue(null)

    const context = await resolveSessionContext('sess_token', baseContext)

    expect(context?.apiKeyId).toBe('session-key-1')
    expect(context).not.toHaveProperty('apiKeyUserId')
  })

  it('carries a regular header key id without a backing user', async () => {
    const regularKey = { id: 'regular-key-1', tenantId: 'tenant-1', organizationId: 'org-1', createdBy: 'creator-1' } as unknown as ApiKey
    resolveVerifiedSessionKeyUserId.mockResolvedValue(null)

    const context = await resolveApiKeyContext(regularKey, baseContext)

    expect(resolveVerifiedSessionKeyUserId).toHaveBeenCalledWith(em, regularKey)
    expect(context).toMatchObject({ apiKeyId: 'regular-key-1', userId: 'creator-1' })
    expect(context).not.toHaveProperty('apiKeyUserId')
  })
})
