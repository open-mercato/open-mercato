import { NextRequest } from 'next/server'

const mockFindOne = jest.fn()
const mockGetJob = jest.fn()
const mockGetJobLogs = jest.fn()
const mockClose = jest.fn()
const mockLogError = jest.fn()
const mockLogWarning = jest.fn()
const mockReportError = jest.fn()
const mockGetTelemetryRuntime = jest.fn()
const mockGetAuth = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: () => mockGetAuth(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: () => ({ findOne: mockFindOne }) }),
}))

jest.mock('../../../data/entities.js', () => ({ ScheduledJob: class ScheduledJob {} }))
jest.mock('../../../lib/scheduleAccess.js', () => ({ resolveScheduleAccess: () => 'allowed' }))

jest.mock('@open-mercato/shared/lib/redis/connection', () => ({
  getRedisUrlOrThrow: () => 'redis://localhost:6379',
  parseRedisUrl: () => ({ host: 'localhost', port: 6379 }),
}))

jest.mock('@open-mercato/shared/lib/modules/registry', () => ({
  getModules: () => [{ id: 'scheduler', workers: [{ queue: 'scheduler-execution' }] }],
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string) => `translated:${key}` }),
}))

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ child: () => ({ error: mockLogError, warn: mockLogWarning }) }),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => mockGetTelemetryRuntime(),
}))

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    getJob: mockGetJob,
    getJobLogs: mockGetJobLogs,
    close: mockClose,
    getCompleted: async () => [],
    getFailed: async () => [],
    getActive: async () => [],
    getWaiting: async () => [],
    getDelayed: async () => [],
  })),
}))

import { GET as getExecutions } from '../[id]/executions/route'
import { GET as getQueueJob } from '../../queue-jobs/[jobId]/route'

const scheduleId = '11111111-1111-4111-8111-111111111111'

const routes = [
  {
    name: 'execution history',
    errorKey: 'scheduler.error.fetch_executions_failed',
    reportCode: 'scheduler.fetch_executions_failed',
    fail: (error: unknown) => mockFindOne.mockRejectedValue(error),
    succeed: () => mockFindOne.mockResolvedValue({ id: scheduleId }),
    successBody: { items: [], total: 0, page: 1, pageSize: 20 },
    call: () => getExecutions(
      new NextRequest(`http://localhost/api/scheduler/jobs/${scheduleId}/executions`),
      { params: { id: scheduleId } },
    ),
  },
  {
    name: 'queue job details',
    errorKey: 'scheduler.error.fetch_job_failed',
    reportCode: 'scheduler.fetch_job_failed',
    fail: (error: unknown) => mockGetJob.mockRejectedValue(error),
    succeed: () => mockGetJob.mockResolvedValue({
      id: 'job-1',
      name: 'scheduler-execution',
      data: { tenantId: 'tenant-1', organizationId: 'org-1', payload: { scheduleId } },
      getState: async () => 'completed',
      returnvalue: { complete: true },
    }),
    successBody: {
      id: 'job-1',
      state: 'completed',
      data: { tenantId: 'tenant-1', organizationId: 'org-1', payload: { scheduleId } },
      returnvalue: { complete: true },
      logs: ['completed successfully'],
    },
    call: () => getQueueJob(
      new NextRequest('http://localhost/api/scheduler/queue-jobs/job-1?queue=scheduler-execution'),
      { params: { jobId: 'job-1' } },
    ),
  },
]

describe.each(routes)('scheduler $name error responses', (route) => {
  const originalQueueStrategy = process.env.QUEUE_STRATEGY

  beforeEach(() => {
    jest.clearAllMocks()
    mockReportError.mockReset()
    process.env.QUEUE_STRATEGY = 'async'
    mockGetAuth.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    mockFindOne.mockResolvedValue({ id: scheduleId })
    mockGetJob.mockResolvedValue(null)
    mockGetJobLogs.mockResolvedValue({ logs: ['completed successfully'] })
    mockClose.mockResolvedValue(undefined)
    mockGetTelemetryRuntime.mockReturnValue({ reportError: mockReportError })
  })

  afterEach(() => {
    if (originalQueueStrategy === undefined) delete process.env.QUEUE_STRATEGY
    else process.env.QUEUE_STRATEGY = originalQueueStrategy
  })

  it.each([
    new Error('synthetic database or Redis failure with internal connection details'),
    { message: 'synthetic infrastructure failure', internalHost: 'private.example' },
  ])('returns the translated fallback and retains server diagnostics for %p', async (error) => {
    route.fail(error)

    const response = await route.call()

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: `translated:${route.errorKey}` })
    expect(mockLogError).toHaveBeenCalledWith(expect.any(String), { err: error })
    expect(mockReportError).toHaveBeenCalledWith(error, { module: 'scheduler', code: route.reportCode })
  })

  it('keeps the translated failure response when telemetry is disabled', async () => {
    mockGetTelemetryRuntime.mockReturnValue(null)
    route.fail(new Error('synthetic private infrastructure details'))

    const response = await route.call()

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: `translated:${route.errorKey}` })
    expect(mockReportError).not.toHaveBeenCalled()
  })

  it('keeps the translated failure response when telemetry throws', async () => {
    const error = new Error('synthetic private infrastructure details')
    const telemetryError = new Error('synthetic telemetry failure')
    route.fail(error)
    mockReportError.mockImplementation(() => { throw telemetryError })

    const response = await route.call()

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: `translated:${route.errorKey}` })
    expect(mockReportError).toHaveBeenCalledTimes(1)
    expect(mockReportError).toHaveBeenCalledWith(error, { module: 'scheduler', code: route.reportCode })
    expect(mockLogWarning).toHaveBeenCalledWith(expect.any(String), { err: telemetryError })
  })

  it('preserves the unauthenticated refusal before infrastructure access', async () => {
    mockGetAuth.mockResolvedValue(null)

    const response = await route.call()

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'translated:scheduler.error.unauthorized' })
    expect(mockFindOne).not.toHaveBeenCalled()
    expect(mockGetJob).not.toHaveBeenCalled()
    expect(mockReportError).not.toHaveBeenCalled()
  })

  it('preserves successful reads', async () => {
    route.succeed()

    const response = await route.call()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(expect.objectContaining(route.successBody))
    expect(mockClose).toHaveBeenCalledTimes(1)
    expect(mockReportError).not.toHaveBeenCalled()
  })

  it('preserves missing-record responses', async () => {
    mockFindOne.mockResolvedValue(null)

    const response = await route.call()

    expect(response.status).toBe(404)
    expect(mockReportError).not.toHaveBeenCalled()
  })
})
