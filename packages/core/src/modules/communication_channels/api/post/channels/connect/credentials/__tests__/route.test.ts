/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockValidateRouteMutationGuard = jest.fn()
const mockExecute = jest.fn()
const mockRegistryGet = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))
jest.mock('../../../../../../lib/route-mutation-guard', () => ({
  validateRouteMutationGuard: (...args: unknown[]) => mockValidateRouteMutationGuard(...args),
}))

import { POST } from '../route'

const AUTH = {
  sub: '33333333-3333-4333-8333-333333333333',
  tenantId: '11111111-1111-4111-8111-111111111111',
  orgId: '22222222-2222-4222-8222-222222222222',
}

const ADAPTERS: Record<string, Record<string, unknown>> = {
  // Push provider: tenant-scoped — must be refused on the per-user route.
  fcm: { providerKey: 'fcm', channelType: 'push', channelScope: 'tenant', capabilities: {} },
  // Mailbox provider: per-user (channelScope omitted) — allowed here.
  imap: { providerKey: 'imap', channelType: 'email', capabilities: {} },
}

function connectRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/communication_channels/channels/connect/credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/communication_channels/channels/connect/credentials (per-user route)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue(AUTH)
    mockCreateRequestContainer.mockResolvedValue({
      resolve: (token: string) => {
        if (token === 'channelAdapterRegistry') return { get: mockRegistryGet }
        if (token === 'commandBus') return { execute: mockExecute }
        throw new Error(`[internal] unexpected resolve(${token})`)
      },
    })
    mockRegistryGet.mockImplementation((key: string) => ADAPTERS[key])
    mockValidateRouteMutationGuard.mockResolvedValue({ afterSuccess: jest.fn(async () => undefined) })
    mockExecute.mockResolvedValue({
      result: { status: 'connected', channelId: 'ch-1', externalIdentifier: null },
    })
  })

  it('refuses a tenant-scoped push provider with 403 before dispatching the command', async () => {
    const response = await POST(
      connectRequest({ providerKey: 'fcm', displayName: 'FCM', credentials: {} }),
    )

    expect(response.status).toBe(403)
    const body = (await response.json()) as { code?: string }
    expect(body.code).toBe('provider_is_tenant_scoped')
    // The privilege-escalation guard must short-circuit before the mutation guard
    // and before the command runs, so no tenant-wide channel can be minted here.
    expect(mockValidateRouteMutationGuard).not.toHaveBeenCalled()
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('lets a per-user provider through to the command (userId bound from the session)', async () => {
    const response = await POST(
      connectRequest({ providerKey: 'imap', displayName: 'Work mail', credentials: { username: 'a@b.com' } }),
    )

    expect(response.status).toBe(201)
    expect(mockExecute).toHaveBeenCalledTimes(1)
    const dispatch = mockExecute.mock.calls[0][1] as { input: { userId: string | null } }
    expect(dispatch.input.userId).toBe(AUTH.sub)
  })
})
