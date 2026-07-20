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
  // Push provider: tenant-scoped — the only kind this admin route accepts.
  fcm: { providerKey: 'fcm', channelType: 'push', channelScope: 'tenant', capabilities: {} },
  // Mailbox provider: per-user — an admin must not force it tenant-wide here.
  imap: { providerKey: 'imap', channelType: 'email', capabilities: {} },
}

function connectRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/communication_channels/channels/connect/tenant-credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/communication_channels/channels/connect/tenant-credentials (admin route)', () => {
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

  it('rejects a per-user provider with 400 before dispatching the command', async () => {
    const response = await POST(
      connectRequest({ providerKey: 'imap', displayName: 'IMAP', credentials: {} }),
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as { code?: string }
    expect(body.code).toBe('provider_not_tenant_scoped')
    expect(mockValidateRouteMutationGuard).not.toHaveBeenCalled()
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown provider before dispatching the command', async () => {
    const response = await POST(
      connectRequest({ providerKey: 'nope', displayName: 'Nope', credentials: {} }),
    )

    expect(response.status).toBe(404)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('returns 409 with mailbox_already_connected when the command reports a duplicate', async () => {
    mockExecute.mockResolvedValueOnce({
      result: { status: 'duplicate_mailbox', existingProviderKey: 'expo' },
    })

    const response = await POST(
      connectRequest({ providerKey: 'fcm', displayName: 'FCM', credentials: { serviceAccountJson: '{}' } }),
    )

    expect(response.status).toBe(409)
    const body = (await response.json()) as { code?: string }
    expect(body.code).toBe('mailbox_already_connected')
  })

  it('returns 422 with field errors when credential validation fails', async () => {
    mockExecute.mockResolvedValueOnce({
      result: { status: 'validation_failed', errors: { serviceAccountJson: 'Required' } },
    })

    const response = await POST(
      connectRequest({ providerKey: 'fcm', displayName: 'FCM', credentials: {} }),
    )

    expect(response.status).toBe(422)
    const body = (await response.json()) as { fieldErrors?: Record<string, string> }
    expect(body.fieldErrors).toEqual({ serviceAccountJson: 'Required' })
  })

  it('returns 500 with wrong_scope_for_route if the command reports a per-user scope', async () => {
    mockExecute.mockResolvedValueOnce({ result: { status: 'wrong_scope_for_route' } })

    const response = await POST(
      connectRequest({ providerKey: 'fcm', displayName: 'FCM', credentials: { serviceAccountJson: '{}' } }),
    )

    expect(response.status).toBe(500)
    const body = (await response.json()) as { code?: string }
    expect(body.code).toBe('wrong_scope_for_route')
  })

  it('dispatches a tenant-scoped provider with userId: null and returns 201', async () => {
    const response = await POST(
      connectRequest({ providerKey: 'fcm', displayName: 'FCM', credentials: { serviceAccountJson: '{}' } }),
    )

    expect(response.status).toBe(201)
    expect(mockExecute).toHaveBeenCalledTimes(1)
    // The admin route always dispatches tenant-wide — the command re-derives scope,
    // but the route must never pass a per-user id here.
    const dispatch = mockExecute.mock.calls[0][1] as { input: { userId: string | null } }
    expect(dispatch.input.userId).toBeNull()
  })
})
