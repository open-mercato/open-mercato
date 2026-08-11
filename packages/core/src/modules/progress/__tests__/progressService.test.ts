import { createProgressService } from '../lib/progressServiceImpl'
import { PROGRESS_EVENTS } from '../lib/events'
import { calculateEta, calculateProgressPercent, STALE_PENDING_TIMEOUT_SECONDS } from '../lib/progressService'
import type { ProgressJob } from '../data/entities'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
const mockFindOneWithDecryption = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

const baseCtx = {
  tenantId: '7f4c85ef-f8f7-4e53-9df1-42e95bd8d48e',
  organizationId: null,
  userId: '2d4a4c33-9c4b-4e39-8e15-0a3cd9a7f432',
}

const detached = expect.objectContaining({ disableIdentityMap: true })

const buildEm = () => {
  const flush = jest.fn().mockResolvedValue(undefined)
  const persist = jest.fn((_entity: unknown) => ({ flush }))
  const em = {
    create: jest.fn(),
    persist,
    flush,
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
    find: jest.fn(),
    nativeUpdate: jest.fn().mockResolvedValue(1),
    fork: jest.fn(),
  }
  return em
}

const buildForkEm = () => ({
  findOne: jest.fn(),
  nativeUpdate: jest.fn().mockResolvedValue(1),
})

describe('progress service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindOneWithDecryption.mockReset()
  })

  it('createJob — creates entity, persists, emits JOB_CREATED', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    em.create.mockImplementation((_entity, data) => ({ id: 'job-1', ...data }))

    const service = createProgressService(em as never, eventBus)

    const input = { jobType: 'import', name: 'Import contacts', totalCount: 100, cancellable: true }
    const job = await service.createJob(input, baseCtx)

    expect(job.id).toBe('job-1')
    expect(job.status).toBe('pending')
    expect(job.jobType).toBe('import')
    expect(job.cancellable).toBe(true)
    expect(em.persist).toHaveBeenCalledWith(job)
    expect(em.flush).toHaveBeenCalled()
    expect(eventBus.emit).toHaveBeenCalledWith(
      PROGRESS_EVENTS.JOB_CREATED,
      expect.objectContaining({
        jobId: 'job-1',
        jobType: 'import',
        name: 'Import contacts',
        tenantId: baseCtx.tenantId,
      })
    )
  })

  it('startJob — transitions to running via a status-guarded update, emits JOB_STARTED', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = { id: 'job-1', status: 'pending', jobType: 'import' } as ProgressJob
    em.findOneOrFail.mockResolvedValue(job)

    const service = createProgressService(em as never, eventBus)
    const result = await service.startJob('job-1', baseCtx)

    expect(result.status).toBe('running')
    expect(result.startedAt).toBeInstanceOf(Date)
    expect(result.heartbeatAt).toBeInstanceOf(Date)
    expect(em.findOneOrFail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'job-1' }), detached)
    expect(em.nativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'job-1', status: { $in: ['pending', 'failed'] } }),
      expect.objectContaining({ status: 'running' })
    )
    expect(eventBus.emit).toHaveBeenCalledWith(
      PROGRESS_EVENTS.JOB_STARTED,
      expect.objectContaining({ jobId: 'job-1', jobType: 'import', tenantId: baseCtx.tenantId })
    )
  })

  it('startJob — does not resurrect a completed job (at-least-once queue redelivery)', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = { id: 'job-1', status: 'completed', jobType: 'import' } as ProgressJob
    em.findOneOrFail.mockResolvedValue(job)

    const service = createProgressService(em as never, eventBus)
    const result = await service.startJob('job-1', baseCtx)

    expect(result.status).toBe('completed')
    expect(em.nativeUpdate).not.toHaveBeenCalled()
    expect(eventBus.emit).not.toHaveBeenCalled()
  })

  it('startJob — restarts a failed job (queue retry after stale sweep)', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = { id: 'job-1', status: 'failed', jobType: 'import', errorMessage: 'stale' } as ProgressJob
    em.findOneOrFail.mockResolvedValue(job)

    const service = createProgressService(em as never, eventBus)
    const result = await service.startJob('job-1', baseCtx)

    expect(result.status).toBe('running')
    expect(result.errorMessage).toBeNull()
    expect(result.finishedAt).toBeNull()
    expect(eventBus.emit).toHaveBeenCalledWith(PROGRESS_EVENTS.JOB_STARTED, expect.objectContaining({ jobId: 'job-1' }))
  })

  it('startJob — lost transition race returns the fresh row without emitting', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = { id: 'job-1', status: 'pending', jobType: 'import' } as ProgressJob
    const fresh = { id: 'job-1', status: 'cancelled', jobType: 'import' } as ProgressJob
    em.findOneOrFail.mockResolvedValue(job)
    em.findOne.mockResolvedValue(fresh)
    em.nativeUpdate.mockResolvedValue(0)

    const service = createProgressService(em as never, eventBus)
    const result = await service.startJob('job-1', baseCtx)

    expect(result.status).toBe('cancelled')
    expect(eventBus.emit).not.toHaveBeenCalled()
  })

  it('startJob — concurrent stale readers produce exactly one transition event', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const databaseJob = { id: 'job-1', status: 'pending', jobType: 'import' } as ProgressJob
    em.findOneOrFail
      .mockResolvedValueOnce({ ...databaseJob } as ProgressJob)
      .mockResolvedValueOnce({ ...databaseJob } as ProgressJob)
    em.findOne.mockImplementation(async () => ({ ...databaseJob }) as ProgressJob)
    em.nativeUpdate.mockImplementation(async (_entity: unknown, where: unknown, data: unknown) => {
      const statusFilter = (where as { status?: { $in?: string[] } }).status?.$in ?? []
      if (!statusFilter.includes(databaseJob.status)) return 0
      databaseJob.status = (data as { status: ProgressJob['status'] }).status
      return 1
    })

    const firstService = createProgressService(em as never, eventBus)
    const secondService = createProgressService(em as never, eventBus)
    const [firstResult, secondResult] = await Promise.all([
      firstService.startJob('job-1', baseCtx),
      secondService.startJob('job-1', baseCtx),
    ])

    expect(firstResult.status).toBe('running')
    expect(secondResult.status).toBe('running')
    expect(eventBus.emit).toHaveBeenCalledTimes(1)
    expect(eventBus.emit).toHaveBeenCalledWith(
      PROGRESS_EVENTS.JOB_STARTED,
      expect.objectContaining({ jobId: 'job-1' })
    )
  })

  it('updateProgress — auto-calculates progressPercent and ETA, persists via guarded update', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = {
      id: 'job-1',
      jobType: 'import',
      status: 'running',
      processedCount: 0,
      totalCount: 100,
      progressPercent: 0,
      startedAt: new Date(Date.now() - 10_000),
      meta: null,
    } as unknown as ProgressJob
    em.findOneOrFail.mockResolvedValue(job)

    const service = createProgressService(em as never, eventBus)
    const result = await service.updateProgress('job-1', { processedCount: 50 }, baseCtx)

    expect(result.processedCount).toBe(50)
    expect(result.progressPercent).toBe(50)
    expect(result.etaSeconds).toBeGreaterThan(0)
    expect(result.heartbeatAt).toBeInstanceOf(Date)
    expect(em.nativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'job-1', status: { $in: ['pending', 'running'] } }),
      expect.objectContaining({ processedCount: 50, progressPercent: 50 })
    )
    expect(eventBus.emit).toHaveBeenCalledWith(
      PROGRESS_EVENTS.JOB_UPDATED,
      expect.objectContaining({ jobId: 'job-1', processedCount: 50, progressPercent: 50 })
    )
  })

  it('updateProgress — uses explicit progressPercent when provided', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = {
      id: 'job-1',
      jobType: 'import',
      status: 'running',
      processedCount: 0,
      totalCount: 100,
      progressPercent: 0,
      startedAt: new Date(),
      meta: null,
    } as unknown as ProgressJob
    em.findOneOrFail.mockResolvedValue(job)

    const service = createProgressService(em as never, eventBus)
    const result = await service.updateProgress('job-1', { processedCount: 50, progressPercent: 75 }, baseCtx)

    expect(result.progressPercent).toBe(75)
  })

  it('updateProgress — merges meta instead of replacing', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = {
      id: 'job-1',
      jobType: 'import',
      status: 'running',
      processedCount: 0,
      totalCount: null,
      progressPercent: 0,
      startedAt: null,
      meta: { existing: 'value' },
    } as unknown as ProgressJob
    em.findOneOrFail.mockResolvedValue(job)

    const service = createProgressService(em as never, eventBus)
    await service.updateProgress('job-1', { meta: { added: 'new' } }, baseCtx)

    expect(job.meta).toEqual({ existing: 'value', added: 'new' })
  })

  it('updateProgress — returns early without writes when the job is already terminal', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = { id: 'job-1', status: 'cancelled', jobType: 'import' } as ProgressJob
    em.findOneOrFail.mockResolvedValue(job)

    const service = createProgressService(em as never, eventBus)
    const result = await service.updateProgress('job-1', { processedCount: 10 }, baseCtx)

    expect(result.status).toBe('cancelled')
    expect(em.nativeUpdate).not.toHaveBeenCalled()
    expect(eventBus.emit).not.toHaveBeenCalled()
  })

  it('updateProgress — stops writing once the job went terminal in another process', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = {
      id: 'job-1',
      jobType: 'import',
      status: 'running',
      processedCount: 0,
      totalCount: 100,
      progressPercent: 0,
      startedAt: null,
      meta: null,
    } as unknown as ProgressJob
    const fresh = { id: 'job-1', status: 'failed', jobType: 'import' } as ProgressJob
    em.findOneOrFail.mockResolvedValue(job)
    em.findOne.mockResolvedValue(fresh)
    em.nativeUpdate.mockResolvedValue(0)

    const service = createProgressService(em as never, eventBus)
    const result = await service.updateProgress('job-1', { processedCount: 10 }, baseCtx)

    expect(result.status).toBe('failed')
    expect(eventBus.emit).not.toHaveBeenCalled()

    // The throttle cache was dropped, so the next call re-reads and hits the terminal
    // guard. A `failed` status may be a stale-sweep false positive, so the guard attempts
    // exactly one revive through the start CAS; when it loses, nothing else is written.
    em.findOneOrFail.mockResolvedValue(fresh)
    em.nativeUpdate.mockClear()
    const second = await service.updateProgress('job-1', { processedCount: 11 }, baseCtx)
    expect(second.status).toBe('failed')
    expect(em.nativeUpdate).toHaveBeenCalledTimes(1)
    expect(em.nativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: { $in: ['pending', 'failed'] } }),
      expect.objectContaining({ status: 'running' }),
    )
    expect(eventBus.emit).not.toHaveBeenCalled()
  })

  it('incrementProgress — adds delta, persists an atomic SQL increment, emits JOB_UPDATED', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = {
      id: 'job-1',
      jobType: 'import',
      status: 'running',
      processedCount: 40,
      totalCount: 100,
      progressPercent: 40,
      startedAt: new Date(Date.now() - 10_000),
    } as unknown as ProgressJob
    em.findOneOrFail.mockResolvedValue(job)

    const service = createProgressService(em as never, eventBus)
    const result = await service.incrementProgress('job-1', 10, baseCtx)

    expect(result.processedCount).toBe(50)
    expect(result.progressPercent).toBe(50)
    expect(result.heartbeatAt).toBeInstanceOf(Date)
    const [, , data] = em.nativeUpdate.mock.calls[0]
    // Deltas must persist as `processed_count + n`, never as an absolute value that
    // could overwrite a concurrent writer's increments.
    expect(typeof data.processedCount).not.toBe('number')
    expect(eventBus.emit).toHaveBeenCalledWith(
      PROGRESS_EVENTS.JOB_UPDATED,
      expect.objectContaining({ jobId: 'job-1', processedCount: 50, progressPercent: 50 })
    )
  })

  it('incrementProgress — returns and emits the shared database aggregate after a stale-snapshot increment', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const localJob = {
      id: 'job-1',
      jobType: 'import',
      status: 'running',
      processedCount: 98,
      totalCount: 100,
      progressPercent: 98,
      startedAt: new Date(Date.now() - 10_000),
    } as unknown as ProgressJob
    const databaseJob = { ...localJob, processedCount: 99, progressPercent: 99 }
    em.findOneOrFail.mockResolvedValue(localJob)
    em.nativeUpdate.mockImplementation(async () => {
      databaseJob.processedCount += 1
      databaseJob.progressPercent = 100
      return 1
    })
    em.findOne.mockImplementation(async () => ({ ...databaseJob }) as ProgressJob)

    const service = createProgressService(em as never, eventBus)
    const result = await service.incrementProgress('job-1', 1, baseCtx)

    expect(result.processedCount).toBe(100)
    expect(result.progressPercent).toBe(100)
    const [, , data] = em.nativeUpdate.mock.calls[0]
    expect(typeof data.processedCount).not.toBe('number')
    expect(typeof data.progressPercent).not.toBe('number')
    expect(eventBus.emit).toHaveBeenCalledWith(
      PROGRESS_EVENTS.JOB_UPDATED,
      expect.objectContaining({ jobId: 'job-1', processedCount: 100, progressPercent: 100 })
    )
  })

  it('completeJob — guarded transition to completed, emits JOB_COMPLETED after the write', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = {
      id: 'job-1',
      jobType: 'import',
      status: 'running',
      progressPercent: 80,
      etaSeconds: 5,
      tenantId: baseCtx.tenantId,
    } as unknown as ProgressJob
    em.findOne.mockResolvedValue(job)

    const service = createProgressService(em as never, eventBus)
    const result = await service.completeJob('job-1', { resultSummary: { imported: 100 } }, baseCtx)

    expect(result.status).toBe('completed')
    expect(result.progressPercent).toBe(100)
    expect(result.etaSeconds).toBe(0)
    expect(result.finishedAt).toBeInstanceOf(Date)
    expect(result.resultSummary).toEqual({ imported: 100 })
    expect(em.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'job-1', tenantId: baseCtx.tenantId }),
      detached
    )
    expect(em.nativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'job-1', status: { $in: ['pending', 'running', 'failed'] } }),
      expect.objectContaining({ status: 'completed', progressPercent: 100 })
    )
    expect(eventBus.emit).toHaveBeenCalledWith(
      PROGRESS_EVENTS.JOB_COMPLETED,
      expect.objectContaining({ jobId: 'job-1', jobType: 'import', tenantId: baseCtx.tenantId })
    )
  })

  it('completeJob — recovers a job wrongly swept as stale (failed → completed)', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = { id: 'job-1', jobType: 'import', status: 'failed', tenantId: baseCtx.tenantId } as unknown as ProgressJob
    em.findOne.mockResolvedValue(job)

    const service = createProgressService(em as never, eventBus)
    const result = await service.completeJob('job-1', undefined, baseCtx)

    expect(result.status).toBe('completed')
    expect(eventBus.emit).toHaveBeenCalledWith(PROGRESS_EVENTS.JOB_COMPLETED, expect.objectContaining({ jobId: 'job-1' }))
  })

  it('completeJob — never overwrites a cancelled job and stays idempotent when already completed', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const cancelled = { id: 'job-1', jobType: 'import', status: 'cancelled' } as ProgressJob
    em.findOne.mockResolvedValue(cancelled)

    const service = createProgressService(em as never, eventBus)
    const result = await service.completeJob('job-1', undefined, baseCtx)

    expect(result.status).toBe('cancelled')
    expect(em.nativeUpdate).not.toHaveBeenCalled()
    expect(eventBus.emit).not.toHaveBeenCalled()

    const completed = { id: 'job-2', jobType: 'import', status: 'completed' } as ProgressJob
    em.findOne.mockResolvedValue(completed)
    const second = await service.completeJob('job-2', undefined, baseCtx)
    expect(second.status).toBe('completed')
    expect(em.nativeUpdate).not.toHaveBeenCalled()
    expect(eventBus.emit).not.toHaveBeenCalled()
  })

  it('completeJob — lost transition race returns the fresh row without emitting', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = { id: 'job-1', jobType: 'import', status: 'running' } as ProgressJob
    const fresh = { id: 'job-1', jobType: 'import', status: 'cancelled' } as ProgressJob
    em.findOne.mockResolvedValueOnce(job).mockResolvedValueOnce(fresh)
    em.nativeUpdate.mockResolvedValue(0)

    const service = createProgressService(em as never, eventBus)
    const result = await service.completeJob('job-1', undefined, baseCtx)

    expect(result.status).toBe('cancelled')
    expect(eventBus.emit).not.toHaveBeenCalled()
  })

  it('failJob — guarded transition to failed, records error, emits JOB_FAILED', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = {
      id: 'job-1',
      jobType: 'import',
      status: 'running',
      tenantId: baseCtx.tenantId,
    } as unknown as ProgressJob
    em.findOne.mockResolvedValue(job)

    const service = createProgressService(em as never, eventBus)
    const result = await service.failJob('job-1', { errorMessage: 'Network error', errorStack: 'stack...' }, baseCtx)

    expect(result.status).toBe('failed')
    expect(result.finishedAt).toBeInstanceOf(Date)
    expect(result.errorMessage).toBe('Network error')
    expect(result.errorStack).toBe('stack...')
    expect(em.nativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'job-1', status: { $in: ['pending', 'running'] } }),
      expect.objectContaining({ status: 'failed', errorMessage: 'Network error' })
    )
    expect(eventBus.emit).toHaveBeenCalledWith(
      PROGRESS_EVENTS.JOB_FAILED,
      expect.objectContaining({ jobId: 'job-1', errorMessage: 'Network error', tenantId: baseCtx.tenantId })
    )
  })

  it('failJob — no-ops on terminal jobs (no overwrite of completed/cancelled outcomes)', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = { id: 'job-1', jobType: 'import', status: 'completed' } as ProgressJob
    em.findOne.mockResolvedValue(job)

    const service = createProgressService(em as never, eventBus)
    const result = await service.failJob('job-1', { errorMessage: 'late failure' }, baseCtx)

    expect(result.status).toBe('completed')
    expect(em.nativeUpdate).not.toHaveBeenCalled()
    expect(eventBus.emit).not.toHaveBeenCalled()
  })

  it('cancelJob (pending) — atomically transitions to cancelled', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = {
      id: 'job-1',
      jobType: 'import',
      status: 'pending',
      cancellable: true,
    } as unknown as ProgressJob
    em.findOneOrFail.mockResolvedValue(job)

    const service = createProgressService(em as never, eventBus)
    const result = await service.cancelJob('job-1', baseCtx)

    expect(result.status).toBe('cancelled')
    expect(result.finishedAt).toBeInstanceOf(Date)
    expect(result.cancelRequestedAt).toBeInstanceOf(Date)
    expect(result.cancelledByUserId).toBe(baseCtx.userId)
    expect(em.nativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'job-1', cancellable: true, status: 'pending' }),
      expect.objectContaining({ status: 'cancelled' })
    )
    expect(eventBus.emit).toHaveBeenCalledWith(
      PROGRESS_EVENTS.JOB_CANCELLED,
      expect.objectContaining({ jobId: 'job-1', tenantId: baseCtx.tenantId })
    )
  })

  it('cancelJob (running) — sets cancelRequestedAt but keeps running status', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = {
      id: 'job-1',
      jobType: 'import',
      status: 'running',
      cancellable: true,
    } as unknown as ProgressJob
    em.findOneOrFail.mockResolvedValue(job)
    em.nativeUpdate.mockResolvedValueOnce(0).mockResolvedValueOnce(1)

    const service = createProgressService(em as never, eventBus)
    const result = await service.cancelJob('job-1', baseCtx)

    expect(result.status).toBe('running')
    expect(result.cancelRequestedAt).toBeInstanceOf(Date)
    expect(result.cancelledByUserId).toBe(baseCtx.userId)
    expect(result.finishedAt).toBeUndefined()
    expect(em.nativeUpdate).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'job-1', cancellable: true, status: 'running' }),
      expect.not.objectContaining({ status: expect.anything() })
    )
    expect(eventBus.emit).toHaveBeenCalledWith(
      PROGRESS_EVENTS.JOB_CANCELLED,
      expect.objectContaining({ jobId: 'job-1' })
    )
  })

  it('cancelJob — returns the job untouched when it already finished (benign click race)', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = { id: 'job-1', jobType: 'import', status: 'completed', cancellable: true } as ProgressJob
    em.findOneOrFail.mockResolvedValue(job)

    const service = createProgressService(em as never, eventBus)
    const result = await service.cancelJob('job-1', baseCtx)

    expect(result.status).toBe('completed')
    expect(em.nativeUpdate).not.toHaveBeenCalled()
    expect(eventBus.emit).not.toHaveBeenCalled()
  })

  it('cancelJob — throws for an active non-cancellable job', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = { id: 'job-1', jobType: 'import', status: 'running', cancellable: false } as ProgressJob
    em.findOneOrFail.mockResolvedValue(job)

    const service = createProgressService(em as never, eventBus)
    await expect(service.cancelJob('job-1', baseCtx)).rejects.toThrow('not cancellable')
    expect(em.nativeUpdate).not.toHaveBeenCalled()
  })

  it('cancelJob — lost race against a terminal transition returns the fresh row without emitting', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = { id: 'job-1', jobType: 'import', status: 'pending', cancellable: true } as ProgressJob
    const fresh = { id: 'job-1', jobType: 'import', status: 'completed', cancellable: true } as ProgressJob
    em.findOneOrFail.mockResolvedValue(job)
    em.findOne.mockResolvedValue(fresh)
    em.nativeUpdate.mockResolvedValue(0)

    const service = createProgressService(em as never, eventBus)
    const result = await service.cancelJob('job-1', baseCtx)

    expect(result.status).toBe('completed')
    expect(eventBus.emit).not.toHaveBeenCalled()
  })

  it('markCancelled — finalizes running jobs as cancelled', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = {
      id: 'job-1',
      jobType: 'import',
      status: 'running',
      tenantId: baseCtx.tenantId,
    } as unknown as ProgressJob
    em.findOne.mockResolvedValue(job)

    const service = createProgressService(em as never, eventBus)
    const result = await service.markCancelled('job-1', baseCtx)

    expect(result.status).toBe('cancelled')
    expect(result.cancelRequestedAt).toBeInstanceOf(Date)
    expect(result.finishedAt).toBeInstanceOf(Date)
    expect(result.etaSeconds).toBe(0)
    expect(em.nativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'job-1', status: { $in: ['pending', 'running', 'failed'] } }),
      expect.objectContaining({ status: 'cancelled' })
    )
    expect(eventBus.emit).toHaveBeenCalledWith(
      PROGRESS_EVENTS.JOB_CANCELLED,
      expect.objectContaining({ jobId: 'job-1', tenantId: baseCtx.tenantId })
    )
  })

  it('markCancelled — preserves the original cancel requester', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const requestedAt = new Date(Date.now() - 5000)
    const job = {
      id: 'job-1',
      jobType: 'import',
      status: 'running',
      cancelRequestedAt: requestedAt,
      cancelledByUserId: 'original-user',
      tenantId: baseCtx.tenantId,
    } as unknown as ProgressJob
    em.findOne.mockResolvedValue(job)

    const service = createProgressService(em as never, eventBus)
    const result = await service.markCancelled('job-1', baseCtx)

    expect(result.cancelRequestedAt).toBe(requestedAt)
    expect(result.cancelledByUserId).toBe('original-user')
  })

  it('markCancelled — leaves completed jobs alone', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = { id: 'job-1', jobType: 'import', status: 'completed' } as ProgressJob
    em.findOne.mockResolvedValue(job)

    const service = createProgressService(em as never, eventBus)
    const result = await service.markCancelled('job-1', baseCtx)

    expect(result.status).toBe('completed')
    expect(em.nativeUpdate).not.toHaveBeenCalled()
    expect(eventBus.emit).not.toHaveBeenCalled()
  })

  it('markStaleJobsFailed — per-row guarded update, emits only after the write wins', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const staleJob1 = { id: 'stale-1', jobType: 'export', status: 'running', tenantId: baseCtx.tenantId } as unknown as ProgressJob
    const staleJob2 = { id: 'stale-2', jobType: 'import', status: 'running', tenantId: baseCtx.tenantId } as unknown as ProgressJob
    em.find.mockResolvedValueOnce([staleJob1, staleJob2]).mockResolvedValueOnce([])

    const service = createProgressService(em as never, eventBus)
    const count = await service.markStaleJobsFailed(baseCtx.tenantId, 60)

    expect(count).toBe(2)
    expect(staleJob1.status).toBe('failed')
    expect(staleJob1.finishedAt).toBeInstanceOf(Date)
    expect(staleJob1.errorMessage).toContain('no heartbeat for 60 seconds')
    expect(staleJob2.status).toBe('failed')
    expect(em.find).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: baseCtx.tenantId,
        status: 'running',
        $or: [
          { heartbeatAt: { $lt: expect.any(Date) } },
          {
            heartbeatAt: null,
            startedAt: { $lt: expect.any(Date) },
          },
        ],
      }),
      detached
    )
    // The per-row update re-checks the staleness condition so a heartbeat landing
    // between SELECT and UPDATE aborts the failure.
    expect(em.nativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'stale-1', status: 'running', $or: expect.any(Array) }),
      expect.objectContaining({ status: 'failed' })
    )
    expect(eventBus.emit).toHaveBeenCalledTimes(2)
    expect(eventBus.emit).toHaveBeenCalledWith(
      PROGRESS_EVENTS.JOB_FAILED,
      expect.objectContaining({ jobId: 'stale-1', stale: true })
    )
    expect(eventBus.emit).toHaveBeenCalledWith(
      PROGRESS_EVENTS.JOB_FAILED,
      expect.objectContaining({ jobId: 'stale-2', stale: true })
    )
  })

  it('markStaleJobsFailed — a concurrent sweeper that lost the row emits nothing for it', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const staleJob1 = { id: 'stale-1', jobType: 'export', status: 'running', tenantId: baseCtx.tenantId } as unknown as ProgressJob
    const staleJob2 = { id: 'stale-2', jobType: 'import', status: 'running', tenantId: baseCtx.tenantId } as unknown as ProgressJob
    em.find.mockResolvedValueOnce([staleJob1, staleJob2]).mockResolvedValueOnce([])
    em.nativeUpdate.mockResolvedValueOnce(0).mockResolvedValueOnce(1)

    const service = createProgressService(em as never, eventBus)
    const count = await service.markStaleJobsFailed(baseCtx.tenantId, 60)

    expect(count).toBe(1)
    expect(staleJob1.status).toBe('running')
    expect(eventBus.emit).toHaveBeenCalledTimes(1)
    expect(eventBus.emit).toHaveBeenCalledWith(
      PROGRESS_EVENTS.JOB_FAILED,
      expect.objectContaining({ jobId: 'stale-2' })
    )
  })

  it('markStaleJobsFailed — sweeps pending jobs that never started', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const orphan = { id: 'orphan-1', jobType: 'import', status: 'pending', tenantId: baseCtx.tenantId } as unknown as ProgressJob
    em.find.mockResolvedValueOnce([]).mockResolvedValueOnce([orphan])

    const service = createProgressService(em as never, eventBus)
    const count = await service.markStaleJobsFailed(baseCtx.tenantId, 60)

    expect(count).toBe(1)
    expect(orphan.status).toBe('failed')
    expect(orphan.errorMessage).toContain(`never started within ${STALE_PENDING_TIMEOUT_SECONDS} seconds`)
    expect(em.find).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: baseCtx.tenantId,
        status: 'pending',
        createdAt: { $lt: expect.any(Date) },
      }),
      detached
    )
    expect(em.nativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'orphan-1', status: 'pending' }),
      expect.objectContaining({ status: 'failed' })
    )
    expect(eventBus.emit).toHaveBeenCalledWith(
      PROGRESS_EVENTS.JOB_FAILED,
      expect.objectContaining({ jobId: 'orphan-1', stale: true })
    )
  })

  it('isCancellationRequested — returns true when cancelRequestedAt is set for matching tenant', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = {
      id: 'job-1',
      tenantId: baseCtx.tenantId,
      cancelRequestedAt: new Date(),
    } as unknown as ProgressJob
    mockFindOneWithDecryption.mockResolvedValue(job)

    const service = createProgressService(em as never, eventBus)
    const result = await service.isCancellationRequested('job-1', baseCtx.tenantId)

    expect(result).toBe(true)
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
      em,
      expect.anything(),
      expect.objectContaining({ id: 'job-1', tenantId: baseCtx.tenantId }),
      detached
    )
  })

  it('isCancellationRequested — bypasses the identity map so worker polling sees fresh state', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    mockFindOneWithDecryption.mockResolvedValue(null)

    const service = createProgressService(em as never, eventBus)
    await service.isCancellationRequested('job-1', baseCtx.tenantId)

    const options = mockFindOneWithDecryption.mock.calls[0][3]
    expect(options).toEqual(expect.objectContaining({ disableIdentityMap: true }))
  })

  it('isCancellationRequested — returns false when job belongs to a different tenant', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    mockFindOneWithDecryption.mockResolvedValue(null)

    const service = createProgressService(em as never, eventBus)
    const result = await service.isCancellationRequested('job-1', 'other-tenant-id')

    expect(result).toBe(false)
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
      em,
      expect.anything(),
      expect.objectContaining({ id: 'job-1', tenantId: 'other-tenant-id' }),
      detached
    )
  })

  it('isCancellationRequested — returns false when cancelRequestedAt is null', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = {
      id: 'job-1',
      tenantId: baseCtx.tenantId,
      cancelRequestedAt: null,
    } as unknown as ProgressJob
    mockFindOneWithDecryption.mockResolvedValue(job)

    const service = createProgressService(em as never, eventBus)
    const result = await service.isCancellationRequested('job-1', baseCtx.tenantId)

    expect(result).toBe(false)
  })

  it('getRecentlyCompletedJobs — queries completed/failed jobs with tenant scope', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const completedJob = { id: 'done-1', status: 'completed', tenantId: baseCtx.tenantId } as unknown as ProgressJob
    em.find.mockResolvedValue([completedJob])

    const service = createProgressService(em as never, eventBus)
    const result = await service.getRecentlyCompletedJobs(baseCtx)

    expect(result).toEqual([completedJob])
    expect(em.find).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: baseCtx.tenantId,
        status: { $in: ['completed', 'failed'] },
        parentJobId: null,
      }),
      expect.objectContaining({ orderBy: { finishedAt: 'DESC' }, limit: 10 })
    )
  })
})

describe('progress service — organization scoping (#2930)', () => {
  const orgCtx = {
    tenantId: '7f4c85ef-f8f7-4e53-9df1-42e95bd8d48e',
    organizationId: 'b1d0c2a4-1111-4e53-9df1-42e95bd8d999',
    userId: '2d4a4c33-9c4b-4e39-8e15-0a3cd9a7f432',
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockFindOneWithDecryption.mockReset()
  })

  it('getJob — scopes the lookup by organizationId when ctx provides one', async () => {
    const em = buildEm()
    const job = { id: 'job-1', tenantId: orgCtx.tenantId, organizationId: orgCtx.organizationId } as unknown as ProgressJob
    em.findOne.mockResolvedValue(job)

    const service = createProgressService(em as never, { emit: jest.fn() })
    await service.getJob('job-1', orgCtx)

    expect(em.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'job-1', tenantId: orgCtx.tenantId, organizationId: orgCtx.organizationId })
    )
  })

  it('getJob — omits organizationId when ctx has none (superadmin/system)', async () => {
    const em = buildEm()
    em.findOne.mockResolvedValue(null)

    const service = createProgressService(em as never, { emit: jest.fn() })
    await service.getJob('job-1', { ...orgCtx, organizationId: null })

    const filter = em.findOne.mock.calls[0][1]
    expect(filter).not.toHaveProperty('organizationId')
    expect(filter).toMatchObject({ id: 'job-1', tenantId: orgCtx.tenantId })
  })

  it('updateProgress — scopes the lookup by organizationId when ctx provides one', async () => {
    const em = buildEm()
    const job = { id: 'job-1', status: 'running', processedCount: 0, totalCount: null, startedAt: null, meta: null } as unknown as ProgressJob
    em.findOneOrFail.mockResolvedValue(job)

    const service = createProgressService(em as never, { emit: jest.fn().mockResolvedValue(undefined) })
    await service.updateProgress('job-1', { processedCount: 1 }, orgCtx)

    expect(em.findOneOrFail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'job-1', tenantId: orgCtx.tenantId, organizationId: orgCtx.organizationId }),
      detached
    )
  })

  it('updateProgress — scopes the guarded write by organizationId', async () => {
    const em = buildEm()
    const job = { id: 'job-1', status: 'running', processedCount: 0, totalCount: null, startedAt: null, meta: null } as unknown as ProgressJob
    em.findOneOrFail.mockResolvedValue(job)

    const service = createProgressService(em as never, { emit: jest.fn().mockResolvedValue(undefined) })
    await service.updateProgress('job-1', { processedCount: 1 }, orgCtx)

    expect(em.nativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'job-1', tenantId: orgCtx.tenantId, organizationId: orgCtx.organizationId }),
      expect.anything()
    )
  })

  it('cancelJob — scopes the lookup by organizationId when ctx provides one', async () => {
    const em = buildEm()
    const job = { id: 'job-1', status: 'pending', cancellable: true } as unknown as ProgressJob
    em.findOneOrFail.mockResolvedValue(job)

    const service = createProgressService(em as never, { emit: jest.fn().mockResolvedValue(undefined) })
    await service.cancelJob('job-1', orgCtx)

    expect(em.findOneOrFail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'job-1', tenantId: orgCtx.tenantId, organizationId: orgCtx.organizationId }),
      detached
    )
    expect(em.nativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'job-1',
        tenantId: orgCtx.tenantId,
        organizationId: orgCtx.organizationId,
        cancellable: true,
        status: 'pending',
      }),
      expect.anything()
    )
  })
})

describe('progress service — worker lifecycle organization scoping (#3284)', () => {
  const orgCtx = {
    tenantId: '7f4c85ef-f8f7-4e53-9df1-42e95bd8d48e',
    organizationId: 'b1d0c2a4-1111-4e53-9df1-42e95bd8d999',
    userId: '2d4a4c33-9c4b-4e39-8e15-0a3cd9a7f432',
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockFindOneWithDecryption.mockReset()
  })

  it('startJob — scopes the lookup by organizationId when ctx provides one', async () => {
    const em = buildEm()
    const job = { id: 'job-1', status: 'pending', jobType: 'import' } as unknown as ProgressJob
    em.findOneOrFail.mockResolvedValue(job)

    const service = createProgressService(em as never, { emit: jest.fn().mockResolvedValue(undefined) })
    await service.startJob('job-1', orgCtx)

    expect(em.findOneOrFail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'job-1', tenantId: orgCtx.tenantId, organizationId: orgCtx.organizationId }),
      detached
    )
  })

  it('incrementProgress — scopes the lookup by organizationId when ctx provides one', async () => {
    const em = buildEm()
    const job = { id: 'job-1', status: 'running', processedCount: 0, totalCount: null, startedAt: null } as unknown as ProgressJob
    em.findOneOrFail.mockResolvedValue(job)

    const service = createProgressService(em as never, { emit: jest.fn().mockResolvedValue(undefined) })
    await service.incrementProgress('job-1', 1, orgCtx)

    expect(em.findOneOrFail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'job-1', tenantId: orgCtx.tenantId, organizationId: orgCtx.organizationId }),
      detached
    )
  })

  it('completeJob — scopes the lookup by organizationId when ctx provides one', async () => {
    const em = buildEm()
    const job = { id: 'job-1', status: 'running', jobType: 'import' } as unknown as ProgressJob
    em.findOne.mockResolvedValue(job)

    const service = createProgressService(em as never, { emit: jest.fn().mockResolvedValue(undefined) })
    await service.completeJob('job-1', undefined, orgCtx)

    expect(em.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'job-1', tenantId: orgCtx.tenantId, organizationId: orgCtx.organizationId }),
      detached
    )
  })

  it('failJob — scopes the lookup by organizationId when ctx provides one', async () => {
    const em = buildEm()
    const job = { id: 'job-1', status: 'running', jobType: 'import' } as unknown as ProgressJob
    em.findOne.mockResolvedValue(job)

    const service = createProgressService(em as never, { emit: jest.fn().mockResolvedValue(undefined) })
    await service.failJob('job-1', { errorMessage: 'boom' }, orgCtx)

    expect(em.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'job-1', tenantId: orgCtx.tenantId, organizationId: orgCtx.organizationId }),
      detached
    )
  })

  it('markCancelled — scopes the lookup by organizationId when ctx provides one', async () => {
    const em = buildEm()
    const job = { id: 'job-1', status: 'running', jobType: 'import' } as unknown as ProgressJob
    em.findOne.mockResolvedValue(job)

    const service = createProgressService(em as never, { emit: jest.fn().mockResolvedValue(undefined) })
    await service.markCancelled('job-1', orgCtx)

    expect(em.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'job-1', tenantId: orgCtx.tenantId, organizationId: orgCtx.organizationId }),
      detached
    )
  })

  it('lifecycle lookups omit organizationId when ctx has none (system/superadmin)', async () => {
    const em = buildEm()
    const job = { id: 'job-1', status: 'running', jobType: 'import' } as unknown as ProgressJob
    em.findOne.mockResolvedValue(job)

    const service = createProgressService(em as never, { emit: jest.fn().mockResolvedValue(undefined) })
    await service.completeJob('job-1', undefined, { ...orgCtx, organizationId: null })

    const filter = em.findOne.mock.calls[0][1]
    expect(filter).not.toHaveProperty('organizationId')
    expect(filter).toMatchObject({ id: 'job-1', tenantId: orgCtx.tenantId })
  })

  it('isCancellationRequested — scopes the lookup by organizationId when provided', async () => {
    const em = buildEm()
    mockFindOneWithDecryption.mockResolvedValue({ id: 'job-1', cancelRequestedAt: new Date() } as unknown as ProgressJob)

    const service = createProgressService(em as never, { emit: jest.fn() })
    const result = await service.isCancellationRequested('job-1', orgCtx.tenantId, orgCtx.organizationId)

    expect(result).toBe(true)
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
      em,
      expect.anything(),
      expect.objectContaining({ id: 'job-1', tenantId: orgCtx.tenantId, organizationId: orgCtx.organizationId }),
      detached
    )
  })

  it('isCancellationRequested — stays tenant-wide when no organizationId is provided', async () => {
    const em = buildEm()
    mockFindOneWithDecryption.mockResolvedValue(null)

    const service = createProgressService(em as never, { emit: jest.fn() })
    await service.isCancellationRequested('job-1', orgCtx.tenantId)

    const filter = mockFindOneWithDecryption.mock.calls[0][2]
    expect(filter).not.toHaveProperty('organizationId')
    expect(filter).toMatchObject({ id: 'job-1', tenantId: orgCtx.tenantId })
  })

  it('markStaleJobsFailed — scopes the lookup by organizationId when provided', async () => {
    const em = buildEm()
    em.find.mockResolvedValue([])

    const service = createProgressService(em as never, { emit: jest.fn().mockResolvedValue(undefined) })
    await service.markStaleJobsFailed(orgCtx.tenantId, 60, orgCtx.organizationId)

    expect(em.find).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: orgCtx.tenantId, organizationId: orgCtx.organizationId, status: 'running' }),
      detached
    )
  })

  it('markStaleJobsFailed — stays tenant-wide when no organizationId is provided (system cleanup)', async () => {
    const em = buildEm()
    em.find.mockResolvedValue([])

    const service = createProgressService(em as never, { emit: jest.fn().mockResolvedValue(undefined) })
    await service.markStaleJobsFailed(orgCtx.tenantId, 60)

    const filter = em.find.mock.calls[0][1]
    expect(filter).not.toHaveProperty('organizationId')
    expect(filter).toMatchObject({ tenantId: orgCtx.tenantId, status: 'running' })
  })
})

describe('progress service — broadcast coalescing (#2972)', () => {
  const originalInterval = process.env.OM_PROGRESS_BROADCAST_MIN_INTERVAL_MS

  afterEach(() => {
    if (originalInterval === undefined) {
      delete process.env.OM_PROGRESS_BROADCAST_MIN_INTERVAL_MS
    } else {
      process.env.OM_PROGRESS_BROADCAST_MIN_INTERVAL_MS = originalInterval
    }
    jest.restoreAllMocks()
  })

  const buildRunningJob = (overrides: Partial<ProgressJob> = {}) =>
    ({
      id: 'job-1',
      jobType: 'import',
      status: 'running',
      processedCount: 0,
      totalCount: 1000,
      progressPercent: 0,
      startedAt: new Date(Date.now() - 10_000),
      meta: null,
      ...overrides,
    }) as unknown as ProgressJob

  it('coalesces rapid successive updates within the interval into a single write + broadcast', async () => {
    process.env.OM_PROGRESS_BROADCAST_MIN_INTERVAL_MS = '1000'
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const job = buildRunningJob()
    em.findOneOrFail.mockResolvedValue(job)

    const service = createProgressService(em as never, eventBus)
    await service.updateProgress('job-1', { processedCount: 1 }, baseCtx)
    await service.updateProgress('job-1', { processedCount: 2 }, baseCtx)
    await service.updateProgress('job-1', { processedCount: 3 }, baseCtx)

    // Leading edge broadcasts once; the sub-percent follow-ups stay buffered.
    expect(eventBus.emit).toHaveBeenCalledTimes(1)
    expect(em.nativeUpdate).toHaveBeenCalledTimes(1)
    // The job is cached after the first load, so no repeat SELECT per record.
    expect(em.findOneOrFail).toHaveBeenCalledTimes(1)
    // In-memory state still reflects the latest buffered update for the return contract.
    expect(job.processedCount).toBe(3)
  })

  it('re-broadcasts within the interval when progressPercent advances by >= 1', async () => {
    process.env.OM_PROGRESS_BROADCAST_MIN_INTERVAL_MS = '1000'
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const job = buildRunningJob({ totalCount: 100 })
    em.findOneOrFail.mockResolvedValue(job)

    const service = createProgressService(em as never, eventBus)
    await service.updateProgress('job-1', { processedCount: 0 }, baseCtx)
    await service.updateProgress('job-1', { processedCount: 1 }, baseCtx)

    expect(eventBus.emit).toHaveBeenCalledTimes(2)
    expect(eventBus.emit).toHaveBeenLastCalledWith(
      PROGRESS_EVENTS.JOB_UPDATED,
      expect.objectContaining({ jobId: 'job-1', processedCount: 1, progressPercent: 1 })
    )
  })

  it('restores per-update emission when OM_PROGRESS_BROADCAST_MIN_INTERVAL_MS=0', async () => {
    process.env.OM_PROGRESS_BROADCAST_MIN_INTERVAL_MS = '0'
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const job = buildRunningJob()
    em.findOneOrFail.mockResolvedValue(job)

    const service = createProgressService(em as never, eventBus)
    await service.updateProgress('job-1', { processedCount: 1 }, baseCtx)
    await service.updateProgress('job-1', { processedCount: 2 }, baseCtx)

    expect(eventBus.emit).toHaveBeenCalledTimes(2)
    expect(em.nativeUpdate).toHaveBeenCalledTimes(2)
  })

  it('persists heartbeats even when the broadcast interval suppresses emission', async () => {
    // A broadcast interval far above the stale-job timeout must never starve the
    // database of heartbeats — persistence is capped at HEARTBEAT_INTERVAL_MS.
    process.env.OM_PROGRESS_BROADCAST_MIN_INTERVAL_MS = String(10 * 60 * 1000)
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const job = buildRunningJob({ totalCount: null })
    em.findOneOrFail.mockResolvedValue(job)

    let nowMs = Date.now()
    jest.spyOn(Date, 'now').mockImplementation(() => nowMs)

    const service = createProgressService(em as never, eventBus)
    await service.updateProgress('job-1', { processedCount: 1 }, baseCtx) // leading edge: persist + broadcast
    expect(em.nativeUpdate).toHaveBeenCalledTimes(1)
    expect(eventBus.emit).toHaveBeenCalledTimes(1)

    nowMs += 6000 // beyond HEARTBEAT_INTERVAL_MS, far below the broadcast interval
    await service.updateProgress('job-1', { processedCount: 2 }, baseCtx)

    expect(em.nativeUpdate).toHaveBeenCalledTimes(2)
    expect(eventBus.emit).toHaveBeenCalledTimes(1)
  })

  it('flushes buffered progress into the terminal completeJob event', async () => {
    process.env.OM_PROGRESS_BROADCAST_MIN_INTERVAL_MS = '1000'
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const job = buildRunningJob({ tenantId: baseCtx.tenantId })
    em.findOneOrFail.mockResolvedValue(job)
    em.findOne.mockResolvedValue(job)

    const service = createProgressService(em as never, eventBus)
    await service.updateProgress('job-1', { processedCount: 5 }, baseCtx) // leading edge broadcast
    await service.updateProgress('job-1', { processedCount: 7 }, baseCtx) // buffered, not broadcast

    expect(eventBus.emit).toHaveBeenCalledTimes(1)

    await service.completeJob('job-1', { resultSummary: { imported: 7 } }, baseCtx)

    expect(job.processedCount).toBe(7)
    expect(job.status).toBe('completed')
    expect(em.nativeUpdate).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'job-1' }),
      expect.objectContaining({ status: 'completed', processedCount: 7 })
    )
    expect(eventBus.emit).toHaveBeenLastCalledWith(
      PROGRESS_EVENTS.JOB_COMPLETED,
      expect.objectContaining({ jobId: 'job-1', processedCount: 7, progressPercent: 100 })
    )
  })
})

describe('calculateProgressPercent', () => {
  it('returns correct percentage', () => {
    expect(calculateProgressPercent(50, 100)).toBe(50)
    expect(calculateProgressPercent(1, 3)).toBe(33)
    expect(calculateProgressPercent(2, 3)).toBe(67)
  })

  it('clamps at 100', () => {
    expect(calculateProgressPercent(150, 100)).toBe(100)
  })

  it('returns 0 for null or zero totalCount', () => {
    expect(calculateProgressPercent(50, null)).toBe(0)
    expect(calculateProgressPercent(50, 0)).toBe(0)
  })
})

describe('calculateEta', () => {
  it('returns null when processedCount is zero', () => {
    expect(calculateEta(0, 100, new Date())).toBeNull()
  })

  it('returns null when totalCount is zero', () => {
    expect(calculateEta(50, 0, new Date())).toBeNull()
  })

  it('calculates remaining seconds correctly', () => {
    const startedAt = new Date(Date.now() - 10_000)
    const eta = calculateEta(50, 100, startedAt)

    expect(eta).not.toBeNull()
    expect(eta!).toBeGreaterThan(0)
    expect(eta!).toBeLessThanOrEqual(11)
  })
})

describe('progress service — stale-sweep recovery (GSM-314)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('touchJobHeartbeat — bumps only heartbeatAt/updatedAt on a forked EM, no events', async () => {
    const em = buildEm()
    const forkEm = buildForkEm()
    em.fork.mockReturnValue(forkEm)
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const service = createProgressService(em as never, eventBus)
    await service.touchJobHeartbeat!('job-1', baseCtx)

    expect(forkEm.nativeUpdate).toHaveBeenCalledTimes(1)
    const [, filter, data] = forkEm.nativeUpdate.mock.calls[0]
    expect(filter).toEqual(
      expect.objectContaining({ id: 'job-1', tenantId: baseCtx.tenantId, status: { $in: ['pending', 'running'] } }),
    )
    // Heartbeats must never touch counters or status — only liveness columns.
    expect(Object.keys(data).sort()).toEqual(['heartbeatAt', 'updatedAt'])
    expect(forkEm.findOne).not.toHaveBeenCalled()
    expect(em.nativeUpdate).not.toHaveBeenCalled()
    expect(eventBus.emit).not.toHaveBeenCalled()
  })

  it('touchJobHeartbeat — revives a falsely-swept failed job through the start CAS and emits JOB_STARTED', async () => {
    const em = buildEm()
    const forkEm = buildForkEm()
    em.fork.mockReturnValue(forkEm)
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    forkEm.nativeUpdate.mockResolvedValueOnce(0).mockResolvedValueOnce(1)
    forkEm.findOne.mockResolvedValue({
      id: 'job-1',
      jobType: 'data_sync:import',
      status: 'failed',
      processedCount: 200,
      progressPercent: 0,
      organizationId: null,
    } as unknown as ProgressJob)

    const service = createProgressService(em as never, eventBus)
    await service.touchJobHeartbeat!('job-1', baseCtx)

    expect(forkEm.findOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'job-1' }), detached)
    expect(forkEm.nativeUpdate).toHaveBeenCalledTimes(2)
    expect(forkEm.nativeUpdate).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ status: { $in: ['pending', 'failed'] } }),
      expect.objectContaining({ status: 'running', finishedAt: null, errorMessage: null }),
    )
    expect(eventBus.emit).toHaveBeenCalledWith(
      PROGRESS_EVENTS.JOB_STARTED,
      expect.objectContaining({ jobId: 'job-1', status: 'running', tenantId: baseCtx.tenantId }),
    )
  })

  it('touchJobHeartbeat — never revives completed/cancelled or missing jobs', async () => {
    const em = buildEm()
    const forkEm = buildForkEm()
    em.fork.mockReturnValue(forkEm)
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }
    const service = createProgressService(em as never, eventBus)

    forkEm.nativeUpdate.mockResolvedValueOnce(0)
    forkEm.findOne.mockResolvedValueOnce({ id: 'job-1', status: 'completed' } as ProgressJob)
    await service.touchJobHeartbeat!('job-1', baseCtx)
    expect(forkEm.nativeUpdate).toHaveBeenCalledTimes(1)

    forkEm.nativeUpdate.mockResolvedValueOnce(0)
    forkEm.findOne.mockResolvedValueOnce(null)
    await service.touchJobHeartbeat!('job-1', baseCtx)
    expect(forkEm.nativeUpdate).toHaveBeenCalledTimes(2)

    expect(eventBus.emit).not.toHaveBeenCalled()
  })

  it('updateProgress — revives a cached failed job, then applies the update', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = {
      id: 'job-1',
      jobType: 'data_sync:import',
      status: 'failed',
      processedCount: 200,
      totalCount: null,
      progressPercent: 0,
      startedAt: null,
      meta: null,
      organizationId: null,
    } as unknown as ProgressJob
    em.findOneOrFail.mockResolvedValue(job)

    const service = createProgressService(em as never, eventBus)
    const result = await service.updateProgress('job-1', { processedCount: 300 }, baseCtx)

    expect(result.status).toBe('running')
    expect(result.processedCount).toBe(300)
    expect(em.nativeUpdate).toHaveBeenCalledTimes(2)
    expect(em.nativeUpdate).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ status: { $in: ['pending', 'failed'] } }),
      expect.objectContaining({ status: 'running' }),
    )
    expect(em.nativeUpdate).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ status: { $in: ['pending', 'running'] } }),
      expect.objectContaining({ processedCount: 300 }),
    )
    expect(eventBus.emit).toHaveBeenCalledWith(
      PROGRESS_EVENTS.JOB_STARTED,
      expect.objectContaining({ jobId: 'job-1', status: 'running' }),
    )
    expect(eventBus.emit).toHaveBeenCalledWith(
      PROGRESS_EVENTS.JOB_UPDATED,
      expect.objectContaining({ jobId: 'job-1', processedCount: 300 }),
    )
  })

  it('updateProgress — does not revive when the start CAS loses to a real terminal transition', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = { id: 'job-1', jobType: 'import', status: 'failed', processedCount: 10 } as unknown as ProgressJob
    em.findOneOrFail.mockResolvedValue(job)
    em.nativeUpdate.mockResolvedValueOnce(0)

    const service = createProgressService(em as never, eventBus)
    const result = await service.updateProgress('job-1', { processedCount: 11 }, baseCtx)

    expect(result.status).toBe('failed')
    expect(em.nativeUpdate).toHaveBeenCalledTimes(1)
    expect(eventBus.emit).not.toHaveBeenCalled()
  })

  it('incrementProgress — revives a cached failed job and keeps the atomic delta', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = {
      id: 'job-1',
      jobType: 'import',
      status: 'failed',
      processedCount: 40,
      totalCount: 100,
      progressPercent: 40,
      startedAt: new Date(Date.now() - 10_000),
      organizationId: null,
    } as unknown as ProgressJob
    em.findOneOrFail.mockResolvedValue(job)
    em.findOne.mockResolvedValue({ ...job, status: 'running', processedCount: 50, progressPercent: 50 } as ProgressJob)

    const service = createProgressService(em as never, eventBus)
    const result = await service.incrementProgress('job-1', 10, baseCtx)

    expect(result.status).toBe('running')
    expect(em.nativeUpdate).toHaveBeenCalledTimes(2)
    const [, , persistData] = em.nativeUpdate.mock.calls[1]
    expect(typeof persistData.processedCount).not.toBe('number')
    expect(eventBus.emit).toHaveBeenCalledWith(
      PROGRESS_EVENTS.JOB_STARTED,
      expect.objectContaining({ jobId: 'job-1' }),
    )
  })

  it('persist CAS miss — a mid-buffer sweep is revived once and the buffered delta is not dropped', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = {
      id: 'job-1',
      jobType: 'import',
      status: 'running',
      processedCount: 40,
      totalCount: 100,
      progressPercent: 40,
      startedAt: new Date(Date.now() - 10_000),
      organizationId: null,
    } as unknown as ProgressJob
    em.findOneOrFail.mockResolvedValue(job)
    em.nativeUpdate
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
    em.findOne
      .mockResolvedValueOnce({ ...job, status: 'failed' } as ProgressJob)
      .mockResolvedValueOnce({ ...job, status: 'running', processedCount: 50, progressPercent: 50 } as ProgressJob)

    const service = createProgressService(em as never, eventBus)
    const result = await service.incrementProgress('job-1', 10, baseCtx)

    expect(result.status).toBe('running')
    expect(result.processedCount).toBe(50)
    expect(em.nativeUpdate).toHaveBeenCalledTimes(3)
    expect(em.nativeUpdate).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ status: { $in: ['pending', 'failed'] } }),
      expect.objectContaining({ status: 'running' }),
    )
    const [, retryFilter, retryData] = em.nativeUpdate.mock.calls[2]
    expect(retryFilter).toEqual(expect.objectContaining({ status: { $in: ['pending', 'running'] } }))
    expect(typeof retryData.processedCount).not.toBe('number')
    expect(eventBus.emit).toHaveBeenCalledWith(
      PROGRESS_EVENTS.JOB_STARTED,
      expect.objectContaining({ jobId: 'job-1' }),
    )
    expect(eventBus.emit).toHaveBeenCalledWith(
      PROGRESS_EVENTS.JOB_UPDATED,
      expect.objectContaining({ jobId: 'job-1', processedCount: 50 }),
    )
  })
})
