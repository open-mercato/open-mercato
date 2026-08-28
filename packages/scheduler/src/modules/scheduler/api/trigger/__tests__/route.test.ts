import { NextRequest } from 'next/server'
import { CommandInterceptorError } from '@open-mercato/shared/lib/commands/errors'
import type { TriggerScheduleResult } from '../../../commands/trigger'

const scheduleId = '44444444-4444-4444-8444-444444444444'
const userId = '33333333-3333-4333-8333-333333333333'
const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'

const commandBusExecuteMock = jest.fn()
const getAuthFromRequestMock = jest.fn()

const container = {
  resolve: jest.fn((token: string) => {
    if (token === 'commandBus') return { execute: commandBusExecuteMock }
    return {}
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequestMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

import { POST } from '../route'

function request(body: unknown = { id: scheduleId }): NextRequest {
  return new NextRequest('http://localhost/api/scheduler/trigger', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function outcome(partial: Partial<TriggerScheduleResult>): TriggerScheduleResult {
  return {
    scheduleId,
    scheduleName: null,
    targetType: null,
    target: null,
    outcome: 'enqueued',
    queueJobId: null,
    error: null,
    ...partial,
  }
}

describe('POST /api/scheduler/trigger', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getAuthFromRequestMock.mockResolvedValue({ sub: userId, tenantId, orgId: organizationId })
  })

  it('answers 401 without dispatching the command when there is no actor', async () => {
    getAuthFromRequestMock.mockResolvedValue(null)

    const response = await POST(request())

    expect(response.status).toBe(401)
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('answers 400 without dispatching the command when the body is malformed', async () => {
    const response = await POST(request({ id: 'not-a-uuid' }))

    expect(response.status).toBe(400)
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it.each([
    ['enqueued' as const, 200],
    ['not_found' as const, 404],
    ['forbidden' as const, 403],
    ['strategy_unsupported' as const, 400],
    ['failed' as const, 400],
  ])('maps the %s outcome to HTTP %i', async (value, status) => {
    commandBusExecuteMock.mockResolvedValue({
      result: outcome({ outcome: value, queueJobId: value === 'enqueued' ? 'job-1' : null }),
    })

    const response = await POST(request())

    expect(response.status).toBe(status)
    expect(commandBusExecuteMock).toHaveBeenCalledWith(
      'scheduler.jobs.trigger',
      expect.objectContaining({ input: { id: scheduleId } }),
    )
  })

  it('returns the queue job id on a successful enqueue', async () => {
    commandBusExecuteMock.mockResolvedValue({
      result: outcome({ outcome: 'enqueued', queueJobId: 'job-1' }),
    })

    const response = await POST(request())

    expect(await response.json()).toEqual(expect.objectContaining({ ok: true, jobId: 'job-1' }))
  })

  it('surfaces the failure reason a failed outcome carries', async () => {
    commandBusExecuteMock.mockResolvedValue({
      result: outcome({ outcome: 'failed', error: 'Redis unavailable' }),
    })

    const response = await POST(request())

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Redis unavailable' })
  })

  // A `before` interceptor can block the dispatch with a deliberate status and body;
  // flattening that to the generic 400 would make a business rejection look like a
  // malformed request, unlike every CRUD route.
  it('passes an interceptor rejection through with its own status and body', async () => {
    commandBusExecuteMock.mockRejectedValue(
      new CommandInterceptorError('Period is closed', {
        status: 409,
        body: { error: 'Period is closed', reason: 'locked-period' },
      }),
    )

    const response = await POST(request())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Period is closed', reason: 'locked-period' })
  })

  it('keeps the generic 400 for an interceptor rejection that declares no status', async () => {
    commandBusExecuteMock.mockRejectedValue(new CommandInterceptorError('Blocked'))

    const response = await POST(request())

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Blocked' })
  })

  it('answers 400 when the bus throws after the enqueue, e.g. a failing audit store', async () => {
    commandBusExecuteMock.mockRejectedValue(new Error('action log write failed'))

    const response = await POST(request())

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'action log write failed' })
  })
})
