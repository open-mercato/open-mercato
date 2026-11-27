import { NextRequest } from 'next/server'

const scheduleId = '11111111-1111-4111-8111-111111111111'
const otherTenantId = '99999999-9999-4999-8999-999999999999'
const otherOrgId = '88888888-8888-4888-8888-888888888888'

const mockGetAuth = jest.fn()
const mockGetModules = jest.fn()
const mockFindOne = jest.fn()
const mockGetJob = jest.fn()
const mockGetJobLogs = jest.fn()
const mockClose = jest.fn()
const mockQueueConstructor = jest.fn()
const mockLogError = jest.fn()
const mockReportError = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: () => mockGetAuth(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (token: string) => {
      if (token === 'em') return { findOne: mockFindOne }
      return {}
    },
  }),
}))

jest.mock('@open-mercato/shared/lib/modules/registry', () => ({
  getModules: () => mockGetModules(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => `t:${key}:${fallback ?? ''}`,
  }),
}))

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ child: () => ({ error: mockLogError, warn: jest.fn() }) }),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

jest.mock('@open-mercato/shared/lib/redis/connection', () => ({
  getRedisUrlOrThrow: () => 'redis://localhost:6379',
  parseRedisUrl: () => ({ host: 'localhost', port: 6379 }),
}))

jest.mock('../../../data/entities.js', () => ({ ScheduledJob: class ScheduledJob {} }))

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => {
    mockQueueConstructor()
    return {
      getJob: mockGetJob,
      getJobLogs: mockGetJobLogs,
      close: mockClose,
    }
  }),
}))

import { GET as getQueueJob } from '../[jobId]/route'

// The registry view this route resolves queue ownership from: the scheduler
// module owns its execution and test queues, other modules own their own.
const SCHEDULER_REGISTRY = [
  { id: 'scheduler', workers: [{ queue: 'scheduler-execution' }, { queue: 'scheduler-test' }] },
  { id: 'workflows', workers: [{ queue: 'workflow-activities' }] },
  { id: 'notifications', workers: [{ queue: 'notifications' }] },
]

function queueJobRequest(jobId: string, queue: string): NextRequest {
  return new NextRequest(`http://localhost/api/scheduler/queue-jobs/${jobId}?queue=${queue}`)
}

function bullJob(data: unknown) {
  return {
    id: '42',
    name: 'schedule-x',
    data,
    getState: async () => 'completed',
    progress: 7,
    returnvalue: { ok: true },
    failedReason: null,
    stacktrace: null,
    attemptsMade: 1,
    processedOn: null,
    finishedOn: null,
  }
}

describe('GET /api/scheduler/queue-jobs/[jobId] — queue ownership (#9141)', () => {
  const originalQueueStrategy = process.env.QUEUE_STRATEGY

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.QUEUE_STRATEGY = 'async'
    mockGetModules.mockReturnValue(SCHEDULER_REGISTRY)
    mockGetAuth.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    mockGetJob.mockResolvedValue(null)
    mockGetJobLogs.mockResolvedValue({ logs: ['worker log'] })
    mockClose.mockResolvedValue(undefined)
  })

  afterEach(() => {
    if (originalQueueStrategy === undefined) delete process.env.QUEUE_STRATEGY
    else process.env.QUEUE_STRATEGY = originalQueueStrategy
  })

  it('refuses a queue registered by another module', async () => {
    const response = await getQueueJob(queueJobRequest('42', 'workflow-activities'), { params: { jobId: '42' } })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('t:scheduler.error.invalid_queue_name:Invalid queue name')
    expect(mockQueueConstructor).not.toHaveBeenCalled()
    expect(mockGetJob).not.toHaveBeenCalled()
  })

  it('refuses a queue no module registered', async () => {
    const response = await getQueueJob(queueJobRequest('42', 'not-a-registered-queue'), { params: { jobId: '42' } })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('t:scheduler.error.invalid_queue_name:Invalid queue name')
    expect(mockQueueConstructor).not.toHaveBeenCalled()
  })

  it('refuses before any queue access when unauthenticated', async () => {
    mockGetAuth.mockResolvedValue(null)

    const response = await getQueueJob(queueJobRequest('42', 'scheduler-execution'), { params: { jobId: '42' } })
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toBe('t:scheduler.error.unauthorized:Unauthorized')
    expect(mockQueueConstructor).not.toHaveBeenCalled()
  })

  it('refuses the BullMQ read when QUEUE_STRATEGY is local', async () => {
    process.env.QUEUE_STRATEGY = 'local'

    const response = await getQueueJob(queueJobRequest('42', 'scheduler-execution'), { params: { jobId: '42' } })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('t:scheduler.error.bullmq_required:BullMQ job logs are only available with QUEUE_STRATEGY=async')
    expect(body.available).toBe(false)
    expect(mockGetJob).not.toHaveBeenCalled()
  })
})

describe('GET /api/scheduler/queue-jobs/[jobId] — per-schedule access (#9141)', () => {
  const originalQueueStrategy = process.env.QUEUE_STRATEGY

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.QUEUE_STRATEGY = 'async'
    mockGetModules.mockReturnValue(SCHEDULER_REGISTRY)
    mockGetAuth.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1', isSuperAdmin: false })
    mockGetJob.mockResolvedValue(bullJob({ payload: { scheduleId } }))
    mockGetJobLogs.mockResolvedValue({ logs: ['worker log'] })
    mockClose.mockResolvedValue(undefined)
  })

  afterEach(() => {
    if (originalQueueStrategy === undefined) delete process.env.QUEUE_STRATEGY
    else process.env.QUEUE_STRATEGY = originalQueueStrategy
  })

  it('answers 404 for a job missing from BullMQ', async () => {
    mockGetJob.mockResolvedValue(null)

    const response = await getQueueJob(queueJobRequest('42', 'scheduler-execution'), { params: { jobId: '42' } })
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error).toBe('t:scheduler.error.job_not_found:Job not found in BullMQ (may have been removed)')
    expect(mockFindOne).not.toHaveBeenCalled()
  })

  it('fails closed with 404 for a job carrying no scheduleId', async () => {
    mockGetJob.mockResolvedValue(bullJob({ tenantId: 'tenant-1', organizationId: 'org-1' }))

    const response = await getQueueJob(queueJobRequest('42', 'scheduler-execution'), { params: { jobId: '42' } })
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error).toBe('t:scheduler.error.not_found:Schedule not found')
    expect(mockFindOne).not.toHaveBeenCalled()
    expect(mockGetJobLogs).not.toHaveBeenCalled()
  })

  it('fails closed with 404 for a job carrying a malformed scheduleId', async () => {
    mockGetJob.mockResolvedValue(bullJob({ payload: { scheduleId: 'not-a-uuid' } }))

    const response = await getQueueJob(queueJobRequest('42', 'scheduler-execution'), { params: { jobId: '42' } })
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error).toBe('t:scheduler.error.not_found:Schedule not found')
    expect(mockFindOne).not.toHaveBeenCalled()
  })

  it('answers 404 when the schedule row no longer exists', async () => {
    mockFindOne.mockResolvedValue(null)

    const response = await getQueueJob(queueJobRequest('42', 'scheduler-execution'), { params: { jobId: '42' } })
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error).toBe('t:scheduler.error.not_found:Schedule not found')
    expect(mockFindOne).toHaveBeenCalledWith(expect.anything(), { id: scheduleId, deletedAt: null })
    expect(mockGetJobLogs).not.toHaveBeenCalled()
  })

  it('answers 404 for another tenant’s schedule without disclosing it', async () => {
    mockFindOne.mockResolvedValue({ id: scheduleId, tenantId: otherTenantId, organizationId: otherOrgId, scopeType: 'organization' })

    const response = await getQueueJob(queueJobRequest('42', 'scheduler-execution'), { params: { jobId: '42' } })
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error).toBe('t:scheduler.error.not_found:Schedule not found')
    expect(mockGetJobLogs).not.toHaveBeenCalled()
  })

  it('answers 404 for a same-tenant schedule bound to another organization', async () => {
    mockFindOne.mockResolvedValue({ id: scheduleId, tenantId: 'tenant-1', organizationId: otherOrgId, scopeType: 'organization' })

    const response = await getQueueJob(queueJobRequest('42', 'scheduler-execution'), { params: { jobId: '42' } })
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error).toBe('t:scheduler.error.not_found:Schedule not found')
  })

  it('answers 403 for a system-scoped schedule without super-admin', async () => {
    mockFindOne.mockResolvedValue({ id: scheduleId, tenantId: null, organizationId: null, scopeType: 'system' })

    const response = await getQueueJob(queueJobRequest('42', 'scheduler-execution'), { params: { jobId: '42' } })
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toBe('t:scheduler.error.access_denied:Access denied')
    expect(mockGetJobLogs).not.toHaveBeenCalled()
  })

  it('returns the unchanged job payload for the schedule’s own organization', async () => {
    mockFindOne.mockResolvedValue({ id: scheduleId, tenantId: 'tenant-1', organizationId: 'org-1', scopeType: 'organization' })

    const response = await getQueueJob(queueJobRequest('42', 'scheduler-execution'), { params: { jobId: '42' } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      id: '42',
      name: 'schedule-x',
      data: { payload: { scheduleId } },
      state: 'completed',
      progress: 7,
      returnvalue: { ok: true },
      failedReason: null,
      stacktrace: null,
      attemptsMade: 1,
      processedOn: null,
      finishedOn: null,
      logs: ['worker log'],
    })
    expect(mockClose).toHaveBeenCalledTimes(1)
    expect(mockReportError).not.toHaveBeenCalled()
  })

  it('lets a super-admin read a system-scoped schedule’s job', async () => {
    mockGetAuth.mockResolvedValue({ sub: 'root-1', tenantId: null, orgId: null, isSuperAdmin: true })
    mockFindOne.mockResolvedValue({ id: scheduleId, tenantId: null, organizationId: null, scopeType: 'system' })

    const response = await getQueueJob(queueJobRequest('42', 'scheduler-execution'), { params: { jobId: '42' } })

    expect(response.status).toBe(200)
    expect(mockClose).toHaveBeenCalledTimes(1)
  })

  it('also applies the schedule check on the scheduler’s other owned queue', async () => {
    mockGetJob.mockResolvedValue(bullJob({ message: 'qa echo' }))

    const response = await getQueueJob(queueJobRequest('42', 'scheduler-test'), { params: { jobId: '42' } })
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error).toBe('t:scheduler.error.not_found:Schedule not found')
  })

  it('closes the queue on every outcome', async () => {
    mockFindOne.mockResolvedValue({ id: scheduleId, tenantId: otherTenantId, organizationId: null, scopeType: 'tenant' })

    await getQueueJob(queueJobRequest('42', 'scheduler-execution'), { params: { jobId: '42' } })
    expect(mockClose).toHaveBeenCalledTimes(1)

    mockFindOne.mockResolvedValue({ id: scheduleId, tenantId: 'tenant-1', organizationId: 'org-1', scopeType: 'organization' })
    await getQueueJob(queueJobRequest('42', 'scheduler-execution'), { params: { jobId: '42' } })
    expect(mockClose).toHaveBeenCalledTimes(2)
  })
})