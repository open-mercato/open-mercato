/**
 * Tests for POST /api/ai_assistant/mcp-key.
 *
 * The route creates a persistent MCP API key that inherits the calling user's
 * roles. These tests pin the security-critical behavior: the key carries
 * exactly the caller's own roles (no escalation), is scoped to the caller's
 * tenant/organization, and degrades gracefully when the caller has no tenant.
 */

const authMock = jest.fn()
const createRequestContainerMock = jest.fn()
const createApiKeyMock = jest.fn()
const findWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => authMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainerMock(...args),
}))

jest.mock('@open-mercato/core/modules/api_keys/services/apiKeyService', () => ({
  createApiKey: (...args: unknown[]) => createApiKeyMock(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/core/modules/auth/data/entities', () => ({
  UserRole: class UserRole {},
}))

import { POST } from '../route'

function buildRequest(body: unknown): Request {
  return new Request('http://localhost/api/ai_assistant/mcp-key', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/ai_assistant/mcp-key', () => {
  let consoleErrorSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    authMock.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    createRequestContainerMock.mockResolvedValue({
      resolve: (name: string) => (name === 'em' ? {} : null),
    })
    findWithDecryptionMock.mockResolvedValue([
      { role: { id: 'role-a' } },
      { role: { id: 'role-b' } },
    ])
    createApiKeyMock.mockResolvedValue({
      record: {
        id: 'key-1',
        name: 'My MCP Key',
        keyPrefix: 'omk_abc1234',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
      secret: 'omk_abc1234.deadbeef',
    })
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValueOnce(null)

    const response = await POST(buildRequest({ name: 'My MCP Key' }) as any)

    expect(response.status).toBe(401)
    expect(createApiKeyMock).not.toHaveBeenCalled()
  })

  it('creates a key carrying exactly the caller\'s own roles (no escalation)', async () => {
    const response = await POST(buildRequest({ name: 'My MCP Key' }) as any)

    expect(response.status).toBe(200)
    const json = (await response.json()) as Record<string, unknown>
    expect(json.secret).toBe('omk_abc1234.deadbeef')
    expect(json.roles).toEqual(['role-a', 'role-b'])

    expect(createApiKeyMock).toHaveBeenCalledTimes(1)
    const [, input] = createApiKeyMock.mock.calls[0]
    expect(input.roles).toEqual(['role-a', 'role-b'])
    expect(input.tenantId).toBe('tenant-1')
    expect(input.organizationId).toBe('org-1')
    expect(input.createdBy).toBe('user-1')
  })

  it('scopes the role lookup to the caller\'s tenant', async () => {
    await POST(buildRequest({}) as any)

    expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
    const [, , where, , scope] = findWithDecryptionMock.mock.calls[0]
    expect(where.user).toBe('user-1')
    expect(where.role).toEqual({ tenantId: 'tenant-1' })
    expect(scope).toEqual({ tenantId: 'tenant-1', organizationId: null })
  })

  it('assigns no roles and skips the lookup when the caller has no tenant', async () => {
    authMock.mockResolvedValueOnce({ sub: 'user-1', tenantId: null, orgId: null })

    const response = await POST(buildRequest({}) as any)

    expect(response.status).toBe(200)
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
    const [, input] = createApiKeyMock.mock.calls[0]
    expect(input.roles).toEqual([])
  })

  it('ignores malformed role links when resolving ids', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([
      { role: { id: 'role-a' } },
      { role: null },
      { role: { id: '' } },
      {},
    ])

    await POST(buildRequest({}) as any)

    const [, input] = createApiKeyMock.mock.calls[0]
    expect(input.roles).toEqual(['role-a'])
  })

  it('returns 500 with a generic message when key creation fails', async () => {
    createApiKeyMock.mockRejectedValueOnce(new Error('db down'))

    const response = await POST(buildRequest({}) as any)

    expect(response.status).toBe(500)
    const json = (await response.json()) as Record<string, unknown>
    expect(json.error).toBe('Failed to create MCP API key')
  })
})
