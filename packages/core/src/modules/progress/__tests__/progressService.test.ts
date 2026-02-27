import { createProgressService } from '../lib/progressServiceImpl'
import { PROGRESS_EVENTS } from '../lib/events'
import { calculateEta, calculateProgressPercent } from '../lib/progressService'
import type { ProgressJob } from '../data/entities'

const baseCtx = {
  tenantId: '7f4c85ef-f8f7-4e53-9df1-42e95bd8d48e',
  organizationId: null,
  userId: '2d4a4c33-9c4b-4e39-8e15-0a3cd9a7f432',
}

const buildEm = () => {
  const em = {
    create: jest.fn(),
    persistAndFlush: jest.fn().mockResolvedValue(undefined),
    flush: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
    find: jest.fn(),
  }
  return em
}

describe('progress service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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
    expect(em.persistAndFlush).toHaveBeenCalledWith(job)
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

  it('startJob — sets running status, timestamps, emits JOB_STARTED', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = { id: 'job-1', status: 'pending', jobType: 'import' } as ProgressJob
    em.findOneOrFail.mockResolvedValue(job)

    const service = createProgressService(em as never, eventBus)
    const result = await service.startJob('job-1', baseCtx)

    expect(result.status).toBe('running')
    expect(result.startedAt).toBeInstanceOf(Date)
    expect(result.heartbeatAt).toBeInstanceOf(Date)
    expect(em.flush).toHaveBeenCalled()
    expect(eventBus.emit).toHaveBeenCalledWith(
      PROGRESS_EVENTS.JOB_STARTED,
      expect.objectContaining({ jobId: 'job-1', jobType: 'import', tenantId: baseCtx.tenantId })
    )
  })

  it('updateProgress — auto-calculates progressPercent and ETA', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = {
      id: 'job-1',
      jobType: 'import',
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
    expect(em.flush).toHaveBeenCalled()
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

  it('incrementProgress — adds delta, recalculates percent, emits JOB_UPDATED', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const job = {
      id: 'job-1',
      jobType: 'import',
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
    expect(em.flush).toHaveBeenCalled()
    expect(eventBus.emit).toHaveBeenCalledWith(
      PROGRESS_EVENTS.JOB_UPDATED,
      expect.objectContaining({ jobId: 'job-1', processedCount: 50, progressPercent: 50 })
    )
  })

  it('completeJob — sets completed status, progress 100%, emits JOB_COMPLETED', async () => {
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
    expect(em.flush).toHaveBeenCalled()
    expect(em.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'job-1', tenantId: baseCtx.tenantId })
    )
    expect(eventBus.emit).toHaveBeenCalledWith(
      PROGRESS_EVENTS.JOB_COMPLETED,
      expect.objectContaining({ jobId: 'job-1', jobType: 'import', tenantId: baseCtx.tenantId })
    )
  })

  it('failJob — sets failed status, records error, emits JOB_FAILED', async () => {
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
    expect(em.flush).toHaveBeenCalled()
    expect(em.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'job-1', tenantId: baseCtx.tenantId })
    )
    expect(eventBus.emit).toHaveBeenCalledWith(
      PROGRESS_EVENTS.JOB_FAILED,
      expect.objectContaining({ jobId: 'job-1', errorMessage: 'Network error', tenantId: baseCtx.tenantId })
    )
  })

  it('cancelJob (pending) — sets cancelled status immediately', async () => {
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
    expect(em.flush).toHaveBeenCalled()
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

    const service = createProgressService(em as never, eventBus)
    const result = await service.cancelJob('job-1', baseCtx)

    expect(result.status).toBe('running')
    expect(result.cancelRequestedAt).toBeInstanceOf(Date)
    expect(result.cancelledByUserId).toBe(baseCtx.userId)
    expect(result.finishedAt).toBeUndefined()
    expect(eventBus.emit).toHaveBeenCalledWith(
      PROGRESS_EVENTS.JOB_CANCELLED,
      expect.objectContaining({ jobId: 'job-1' })
    )
  })

  it('markStaleJobsFailed — marks stale jobs as failed, emits per job', async () => {
    const em = buildEm()
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) }

    const staleJob1 = { id: 'stale-1', jobType: 'export', status: 'running', tenantId: baseCtx.tenantId } as unknown as ProgressJob
    const staleJob2 = { id: 'stale-2', jobType: 'import', status: 'running', tenantId: baseCtx.tenantId } as unknown as ProgressJob
    em.find.mockResolvedValue([staleJob1, staleJob2])

    const service = createProgressService(em as never, eventBus)
    const count = await service.markStaleJobsFailed(baseCtx.tenantId, 60)

    expect(count).toBe(2)
    expect(staleJob1.status).toBe('failed')
    expect(staleJob1.finishedAt).toBeInstanceOf(Date)
    expect(staleJob1.errorMessage).toContain('no heartbeat for 60 seconds')
    expect(staleJob2.status).toBe('failed')
    expect(em.flush).toHaveBeenCalled()
    expect(em.find).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: baseCtx.tenantId })
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
