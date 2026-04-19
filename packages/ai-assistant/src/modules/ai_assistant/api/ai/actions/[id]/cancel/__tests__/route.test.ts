const authMock = jest.fn()
const loadAclMock = jest.fn()
const createRequestContainerMock = jest.fn()
const repoGetByIdMock = jest.fn()
const repoSetStatusMock = jest.fn()
const emitEventMock = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => authMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainerMock(...args),
}))

jest.mock('../../../../../../data/repositories/AiPendingActionRepository', () => ({
  AiPendingActionRepository: jest.fn().mockImplementation(() => ({
    getById: repoGetByIdMock,
    setStatus: repoSetStatusMock,
  })),
}))

import { setGlobalEventBus } from '@open-mercato/shared/modules/events'
import { POST } from '../route'

function buildRequest(body?: unknown): Request {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  }
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body)
  }
  return new Request('http://localhost/api/ai_assistant/ai/actions/pa_123/cancel', init)
}

function buildContext(id: string) {
  return { params: Promise.resolve({ id }) }
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pa_123',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    agentId: 'catalog.merchandising_assistant',
    toolName: 'catalog.update_product',
    status: 'pending',
    fieldDiff: [{ field: 'title', before: 'Old', after: 'New' }],
    records: null,
    failedRecords: null,
    sideEffectsSummary: null,
    recordVersion: 'v-1',
    attachmentIds: [],
    normalizedInput: { productId: 'p-1', patch: { title: 'New' } },
    queueMode: 'inline',
    executionResult: null,
    targetEntityType: 'product',
    targetRecordId: 'p-1',
    conversationId: null,
    idempotencyKey: 'idem_1',
    createdByUserId: 'user-1',
    createdAt: new Date(Date.now() - 60_000),
    expiresAt: new Date(Date.now() + 3_600_000),
    resolvedAt: null,
    resolvedByUserId: null,
    ...overrides,
  }
}

describe('POST /api/ai/actions/:id/cancel route (Step 5.9)', () => {
  let consoleErrorSpy: jest.SpyInstance
  let consoleWarnSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    authMock.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    loadAclMock.mockResolvedValue({
      features: ['ai_assistant.view'],
      isSuperAdmin: false,
    })
    createRequestContainerMock.mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'rbacService') {
          return {
            loadAcl: loadAclMock,
            hasAllFeatures: (required: string[], granted: string[]) =>
              required.every((feature) => granted.includes(feature)),
          }
        }
        if (name === 'em') return {}
        if (name === 'eventBus') return { emitEvent: emitEventMock }
        return null
      },
    })

    emitEventMock.mockResolvedValue(undefined)
    setGlobalEventBus({
      emit: (eventId, payload, options) => emitEventMock(eventId, payload, options),
    })
    repoSetStatusMock.mockImplementation(
      async (id: string, status: string, _scope: unknown, extra?: any) => {
        return {
          ...makeRow({
            id,
            status,
            executionResult: extra?.executionResult ?? null,
            resolvedAt: extra?.now ?? new Date(),
            resolvedByUserId: extra?.resolvedByUserId ?? null,
          }),
        }
      },
    )
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
    consoleWarnSpy.mockRestore()
  })

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValueOnce(null)
    const response = await POST(buildRequest() as any, buildContext('pa_123'))
    expect(response.status).toBe(401)
  })

  it('happy path: pending → cancelled returns 200 with pendingAction.status === cancelled', async () => {
    repoGetByIdMock.mockResolvedValueOnce(makeRow())

    const response = await POST(buildRequest({ reason: 'Wrong price' }) as any, buildContext('pa_123'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.pendingAction.status).toBe('cancelled')
    expect(body.pendingAction.executionResult).toEqual({
      error: { code: 'cancelled_by_user', message: 'Wrong price' },
    })
    expect(repoSetStatusMock).toHaveBeenCalledTimes(1)
    const [, nextStatus, , extra] = repoSetStatusMock.mock.calls[0]
    expect(nextStatus).toBe('cancelled')
    expect(extra).toMatchObject({ resolvedByUserId: 'user-1' })
    expect(emitEventMock).toHaveBeenCalledTimes(1)
    expect(emitEventMock.mock.calls[0][0]).toBe('ai.action.cancelled')
  })

  it('idempotent: second cancel on cancelled row returns 200 + same row without re-emitting event', async () => {
    const cancelledRow = makeRow({
      status: 'cancelled',
      resolvedAt: new Date('2026-04-18T10:30:00.000Z'),
      resolvedByUserId: 'user-1',
      executionResult: { error: { code: 'cancelled_by_user', message: 'Cancelled by user' } },
    })
    repoGetByIdMock.mockResolvedValueOnce(cancelledRow)

    const response = await POST(buildRequest() as any, buildContext('pa_123'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.pendingAction.status).toBe('cancelled')
    expect(repoSetStatusMock).not.toHaveBeenCalled()
    expect(emitEventMock).not.toHaveBeenCalled()
  })

  it('409 expired: expiresAt in the past flips to expired and returns 409', async () => {
    const expiredRow = makeRow({ expiresAt: new Date('2020-01-01T00:00:00.000Z') })
    repoGetByIdMock.mockResolvedValueOnce(expiredRow)

    const response = await POST(buildRequest() as any, buildContext('pa_123'))
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe('expired')
    // expired branch performs a setStatus('expired', ...) + emits ai.action.expired
    expect(repoSetStatusMock).toHaveBeenCalledTimes(1)
    const [, nextStatus] = repoSetStatusMock.mock.calls[0]
    expect(nextStatus).toBe('expired')
    expect(emitEventMock).toHaveBeenCalledTimes(1)
    expect(emitEventMock.mock.calls[0][0]).toBe('ai.action.expired')
  })

  it('409 invalid_status: already confirmed', async () => {
    repoGetByIdMock.mockResolvedValueOnce(makeRow({ status: 'confirmed' }))

    const response = await POST(buildRequest() as any, buildContext('pa_123'))
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe('invalid_status')
    expect(repoSetStatusMock).not.toHaveBeenCalled()
    expect(emitEventMock).not.toHaveBeenCalled()
  })

  it('409 invalid_status: already executing', async () => {
    repoGetByIdMock.mockResolvedValueOnce(makeRow({ status: 'executing' }))

    const response = await POST(buildRequest() as any, buildContext('pa_123'))
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe('invalid_status')
  })

  it('409 invalid_status: already failed', async () => {
    repoGetByIdMock.mockResolvedValueOnce(makeRow({ status: 'failed' }))

    const response = await POST(buildRequest() as any, buildContext('pa_123'))
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe('invalid_status')
  })

  it('404 pending_action_not_found for cross-tenant / unknown id', async () => {
    repoGetByIdMock.mockResolvedValueOnce(null)

    const response = await POST(buildRequest() as any, buildContext('pa_missing'))
    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.code).toBe('pending_action_not_found')
    expect(repoSetStatusMock).not.toHaveBeenCalled()
  })

  it('403 forbidden when caller lacks ai_assistant.view', async () => {
    loadAclMock.mockResolvedValueOnce({ features: ['catalog.view'], isSuperAdmin: false })

    const response = await POST(buildRequest() as any, buildContext('pa_123'))
    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.code).toBe('forbidden')
    expect(repoGetByIdMock).not.toHaveBeenCalled()
  })

  it('whitespace-only reason becomes empty → default "Cancelled by user" message', async () => {
    repoGetByIdMock.mockResolvedValueOnce(makeRow())

    const response = await POST(buildRequest({ reason: '   \t\n  ' }) as any, buildContext('pa_123'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.pendingAction.executionResult).toEqual({
      error: { code: 'cancelled_by_user', message: 'Cancelled by user' },
    })
  })

  it('400 validation_error when reason exceeds 500 characters', async () => {
    const longReason = 'x'.repeat(501)
    const response = await POST(buildRequest({ reason: longReason }) as any, buildContext('pa_123'))
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.code).toBe('validation_error')
    expect(repoGetByIdMock).not.toHaveBeenCalled()
  })

  it('400 validation_error when body contains unknown fields', async () => {
    const response = await POST(
      buildRequest({ reason: 'ok', evil: 'payload' }) as any,
      buildContext('pa_123'),
    )
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.code).toBe('validation_error')
  })

  it('accepts an empty body (no reason)', async () => {
    repoGetByIdMock.mockResolvedValueOnce(makeRow())

    const response = await POST(buildRequest() as any, buildContext('pa_123'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.pendingAction.executionResult).toEqual({
      error: { code: 'cancelled_by_user', message: 'Cancelled by user' },
    })
  })

  it('500 cancel_internal_error when the repo throws unexpectedly', async () => {
    repoGetByIdMock.mockRejectedValueOnce(new Error('db down'))

    const response = await POST(buildRequest() as any, buildContext('pa_123'))
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.code).toBe('cancel_internal_error')
  })
})
