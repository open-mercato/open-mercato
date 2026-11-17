import type { AwilixContainer } from 'awilix'

const authenticateMcpRequest = jest.fn()
const executeTool = jest.fn()

jest.mock('../auth', () => ({
  authenticateMcpRequest: (...args: unknown[]) => authenticateMcpRequest(...args),
  hasRequiredFeatures: jest.fn(() => true),
}))
jest.mock('../tool-executor', () => ({ executeTool: (...args: unknown[]) => executeTool(...args) }))
jest.mock('../tool-loader', () => ({ loadAllModuleTools: jest.fn() }))
jest.mock('../tool-registry', () => ({ getToolRegistry: () => ({ getTools: () => new Map() }) }))

import { InProcessMcpClient } from '../in-process-client'

const container = {} as AwilixContainer
const keyAuth = {
  success: true, keyId: 'key-1', keyName: 'key', tenantId: 'tenant-1', organizationId: 'org-1',
  userId: 'api_key:key-1', features: ['attachments.view'], isSuperAdmin: false,
}

describe('InProcessMcpClient key principal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    executeTool.mockResolvedValue({ success: true, result: {} })
  })

  it('passes the authenticated key and the verified session user to tool calls', async () => {
    authenticateMcpRequest.mockResolvedValue({ ...keyAuth, apiKeyUserId: 'user-1' })
    const client = await InProcessMcpClient.create({ apiKeySecret: 'omk_key.secret', container })
    await client.callTool('attachments.read_attachment', {})
    expect(executeTool).toHaveBeenCalledWith('attachments.read_attachment', {}, expect.objectContaining({ apiKeyId: 'key-1', apiKeyUserId: 'user-1' }))
  })

  it('carries no key principal for a pre-authenticated user context', async () => {
    const client = await InProcessMcpClient.createWithAuthContext({
      container,
      authContext: { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1', userFeatures: [], isSuperAdmin: false },
    })
    await client.callTool('attachments.read_attachment', {})
    const context = executeTool.mock.calls[0][2]
    expect(context).not.toHaveProperty('apiKeyId')
    expect(context).not.toHaveProperty('apiKeyUserId')
  })
})
