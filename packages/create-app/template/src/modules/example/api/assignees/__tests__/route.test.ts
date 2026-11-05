/** @jest-environment node */

const emitEvent = jest.fn(async () => undefined)
const getAuthFromRequest = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromCookies: jest.fn(),
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequest(...(args as [])),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (name: string) => {
      if (name === 'eventBus') return { emitEvent }
      throw new Error(`Unexpected container resolve: ${name}`)
    },
  })),
}))

import { POST } from '../route'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const foreignOrganizationId = '33333333-3333-4333-8333-333333333333'
const userId = '44444444-4444-4444-8444-444444444444'
const foreignUserId = '55555555-5555-4555-8555-555555555555'

function makeRequest(data: Record<string, unknown>): Request {
  return new Request('http://localhost/api/example/assignees', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  })
}

describe('POST /api/example/assignees event probe scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getAuthFromRequest.mockResolvedValue({
      sub: userId,
      tenantId,
      orgId: organizationId,
      roles: ['admin'],
    })
  })

  it.each([
    ['foreign organization', { organizationId: foreignOrganizationId }],
    ['foreign organization list', { organizationIds: [organizationId, foreignOrganizationId] }],
    ['foreign recipient user', { recipientUserId: foreignUserId }],
    ['foreign recipient user list', { recipientUserIds: [userId, foreignUserId] }],
    ['foreign recipient role', { recipientRoleId: 'employee' }],
    ['foreign recipient role list', { recipientRoleIds: ['admin', 'employee'] }],
  ])('rejects %s targeting without emitting', async (_label, targeting) => {
    const response = await POST(makeRequest({
      eventId: 'example.todo.updated',
      payload: { probeId: 'scope-probe' },
      ...targeting,
    }))

    expect(response.status).toBe(403)
    expect(emitEvent).not.toHaveBeenCalled()
  })

  it.each([
    ['tenant scope', { tenantId: foreignOrganizationId }],
    ['organization scope', { organizationId: foreignOrganizationId }],
    ['organization list', { organizationIds: [foreignOrganizationId] }],
    ['recipient user', { recipientUserId: foreignUserId }],
    ['recipient user list', { recipientUserIds: [foreignUserId] }],
    ['recipient role', { recipientRoleId: 'employee' }],
    ['recipient role list', { recipientRoleIds: ['employee'] }],
    ['todo identity', { id: 'forged-todo-id' }],
  ])('rejects nested payload-authored %s', async (_label, reservedPayload) => {
    const response = await POST(makeRequest({
      eventId: 'example.todo.deleted',
      payload: { probeId: 'nested-scope-probe', ...reservedPayload },
    }))

    expect(response.status).toBe(403)
    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('emits valid same-scope probes with trusted scope and no persistent inline subscribers', async () => {
    const response = await POST(makeRequest({
      eventId: 'example.todo.updated',
      organizationId,
      organizationIds: [organizationId],
      recipientUserId: userId,
      recipientUserIds: [userId],
      recipientRoleId: 'admin',
      recipientRoleIds: ['admin'],
      payload: { probeId: 'valid-scope-probe' },
    }))

    expect(response.status).toBe(200)
    expect(emitEvent).toHaveBeenCalledWith(
      'example.todo.updated',
      {
        probeId: 'valid-scope-probe',
        tenantId,
        organizationId,
        organizationIds: [organizationId],
        recipientUserId: userId,
        recipientUserIds: [userId],
        recipientRoleId: 'admin',
        recipientRoleIds: ['admin'],
      },
      {
        persistent: false,
        skipPersistentSubscribersInline: true,
        tenantId,
        organizationId,
      },
    )
  })

  it('requires an authenticated organization scope', async () => {
    getAuthFromRequest.mockResolvedValue({ sub: userId, tenantId, orgId: null, roles: ['admin'] })

    const response = await POST(makeRequest({ eventId: 'example.todo.updated' }))

    expect(response.status).toBe(403)
    expect(emitEvent).not.toHaveBeenCalled()
  })
})
