import type { EntityManager } from '@mikro-orm/postgresql'
import type { ProgressService } from '@open-mercato/core/modules/progress/lib/progressService'

jest.mock('@open-mercato/core/modules/progress/data/entities', () => ({
  ProgressJob: class ProgressJob {},
}))

import { ProgressJob } from '@open-mercato/core/modules/progress/data/entities'
import {
  cancelReindexProgress,
  completeReindexProgress,
  ensureReindexProgressJob,
  failReindexProgress,
} from '../reindex-progress'

const scope = { type: 'fulltext' as const, tenantId: 'tenant-123', organizationId: 'org-456' }

function makeEm(activeJob: { id: string } | null) {
  return { findOne: jest.fn().mockResolvedValue(activeJob) }
}

function makeProgressService() {
  return {
    createJob: jest.fn().mockResolvedValue({ id: 'job-new' }),
    startJob: jest.fn().mockResolvedValue(undefined),
    updateProgress: jest.fn().mockResolvedValue(undefined),
    completeJob: jest.fn().mockResolvedValue(undefined),
    failJob: jest.fn().mockResolvedValue(undefined),
    cancelJob: jest.fn().mockResolvedValue(undefined),
  }
}

function asEm(em: ReturnType<typeof makeEm>): EntityManager {
  return em as unknown as EntityManager
}

function asService(service: ReturnType<typeof makeProgressService>): ProgressService {
  return service as unknown as ProgressService
}

describe('reindex progress helpers without a progress service', () => {
  test('every helper is a no-op and never reads ProgressJob', async () => {
    const em = makeEm({ id: 'job-1' })

    await expect(ensureReindexProgressJob({ em: asEm(em), progressService: null, ...scope, totalCount: 5 }))
      .resolves.toBeNull()
    await completeReindexProgress({ em: asEm(em), progressService: null, ...scope })
    await failReindexProgress({ em: asEm(em), progressService: null, ...scope, errorMessage: 'boom' })
    await cancelReindexProgress({ em: asEm(em), progressService: null, ...scope, userId: 'user-789' })

    expect(em.findOne).not.toHaveBeenCalled()
  })
})

describe('reindex progress helpers with a progress service', () => {
  test('creates and starts a progress job when none is active', async () => {
    const em = makeEm(null)
    const service = makeProgressService()

    const jobId = await ensureReindexProgressJob({
      em: asEm(em),
      progressService: asService(service),
      ...scope,
      userId: 'user-789',
      totalCount: 5,
    })

    expect(jobId).toBe('job-new')
    expect(em.findOne).toHaveBeenCalledWith(ProgressJob, expect.objectContaining({
      jobType: 'search.reindex.fulltext',
      tenantId: 'tenant-123',
      organizationId: 'org-456',
    }), expect.anything())
    expect(service.createJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobType: 'search.reindex.fulltext', totalCount: 5, cancellable: true }),
      { tenantId: 'tenant-123', organizationId: 'org-456', userId: 'user-789' },
    )
    expect(service.startJob).toHaveBeenCalledWith('job-new', expect.objectContaining({ tenantId: 'tenant-123' }))
  })

  test('completes, fails and cancels the active progress job', async () => {
    const em = makeEm({ id: 'job-1' })
    const service = makeProgressService()

    await completeReindexProgress({ em: asEm(em), progressService: asService(service), ...scope, resultSummary: { recordsIndexed: 3 } })
    await failReindexProgress({ em: asEm(em), progressService: asService(service), ...scope, errorMessage: 'boom' })
    await cancelReindexProgress({ em: asEm(em), progressService: asService(service), ...scope, userId: 'user-789' })

    expect(service.completeJob).toHaveBeenCalledWith('job-1', { resultSummary: { recordsIndexed: 3 } }, expect.anything())
    expect(service.failJob).toHaveBeenCalledWith('job-1', { errorMessage: 'boom' }, expect.anything())
    expect(service.cancelJob).toHaveBeenCalledWith('job-1', expect.objectContaining({ userId: 'user-789' }))
  })
})
