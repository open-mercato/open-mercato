import type { EntityManager } from '@mikro-orm/postgresql'
import type { ProgressJob } from '@open-mercato/core/modules/progress/data/entities'
import type { ProgressService } from '@open-mercato/core/modules/progress/lib/progressService'
import { startReindexProgressJob } from '../reindex-progress'

type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

type FakeJob = {
  id: string
  status: JobStatus
  errorMessage?: string
}

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const SUPERSEDED = 'Superseded by a newer reindex.'

function createHarness(initialJobs: FakeJob[], options: { stuckJobIds?: string[] } = {}) {
  const jobs = [...initialJobs]
  const stuck = new Set(options.stuckJobIds ?? [])
  let created = 0

  const em = {
    findOne: jest.fn(async () => {
      const active = jobs.filter((job) => job.status === 'pending' || job.status === 'running')
      return (active[active.length - 1] ?? null) as unknown as ProgressJob | null
    }),
  }

  const progressService = {
    failJob: jest.fn(async (jobId: string, input: { errorMessage: string }) => {
      const job = jobs.find((entry) => entry.id === jobId)
      if (!job) throw new Error(`[internal] job ${jobId} not found`)
      if (!stuck.has(jobId)) {
        job.status = 'failed'
        job.errorMessage = input.errorMessage
      }
      return { ...job } as unknown as ProgressJob
    }),
    createJob: jest.fn(async () => {
      created += 1
      const job: FakeJob = { id: `new-job-${created}`, status: 'pending' }
      jobs.push(job)
      return { ...job } as unknown as ProgressJob
    }),
    startJob: jest.fn(async (jobId: string) => {
      const job = jobs.find((entry) => entry.id === jobId)
      if (job) job.status = 'running'
      return { ...job } as unknown as ProgressJob
    }),
  }

  const start = () =>
    startReindexProgressJob({
      em: em as unknown as EntityManager,
      progressService: progressService as unknown as ProgressService,
      type: 'fulltext',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      description: 'Reindex all entities (queued)',
      supersededMessage: SUPERSEDED,
    })

  return { jobs, em, progressService, start }
}

describe('startReindexProgressJob', () => {
  it('fails an active job left by a stale run and creates a new running job', async () => {
    const harness = createHarness([{ id: 'orphan-job', status: 'running' }])

    const jobId = await harness.start()

    expect(harness.progressService.failJob).toHaveBeenCalledTimes(1)
    expect(harness.progressService.failJob).toHaveBeenCalledWith(
      'orphan-job',
      { errorMessage: SUPERSEDED },
      { tenantId: TENANT_ID, organizationId: ORG_ID, userId: USER_ID },
    )
    expect(harness.jobs.find((job) => job.id === 'orphan-job')).toMatchObject({
      status: 'failed',
      errorMessage: SUPERSEDED,
    })
    expect(jobId).toBe('new-job-1')
    expect(harness.progressService.createJob).toHaveBeenCalledTimes(1)
    expect(harness.progressService.createJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobType: 'search.reindex.fulltext', cancellable: true }),
      { tenantId: TENANT_ID, organizationId: ORG_ID, userId: USER_ID },
    )
    expect(harness.progressService.startJob).toHaveBeenCalledWith('new-job-1', {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
    })
    expect(harness.jobs.filter((job) => job.status === 'running').map((job) => job.id)).toEqual(['new-job-1'])
  })

  it('fails every active job in the scope before creating the new one', async () => {
    const harness = createHarness([
      { id: 'older-orphan', status: 'pending' },
      { id: 'newer-orphan', status: 'running' },
    ])

    const jobId = await harness.start()

    expect(harness.progressService.failJob.mock.calls.map(([id]) => id)).toEqual(['newer-orphan', 'older-orphan'])
    expect(jobId).toBe('new-job-1')
    expect(harness.progressService.createJob).toHaveBeenCalledTimes(1)
  })

  it('does not fail anything when no job is active', async () => {
    const harness = createHarness([{ id: 'finished-job', status: 'completed' }])

    const jobId = await harness.start()

    expect(harness.progressService.failJob).not.toHaveBeenCalled()
    expect(jobId).toBe('new-job-1')
    expect(harness.progressService.createJob).toHaveBeenCalledTimes(1)
    expect(harness.progressService.startJob).toHaveBeenCalledTimes(1)
  })

  it('stops retrying a job that cannot transition and creates exactly one new job', async () => {
    const harness = createHarness([{ id: 'stuck-job', status: 'running' }], { stuckJobIds: ['stuck-job'] })

    const jobId = await harness.start()

    expect(harness.progressService.failJob).toHaveBeenCalledTimes(1)
    expect(harness.progressService.failJob).toHaveBeenCalledWith(
      'stuck-job',
      { errorMessage: SUPERSEDED },
      { tenantId: TENANT_ID, organizationId: ORG_ID, userId: USER_ID },
    )
    expect(harness.progressService.createJob).toHaveBeenCalledTimes(1)
    expect(harness.progressService.startJob).toHaveBeenCalledTimes(1)
    expect(jobId).toBe('new-job-1')
    expect(harness.jobs.filter((job) => job.id.startsWith('new-job-'))).toHaveLength(1)
  })
})
