import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob } from '@open-mercato/queue'
import handle, { type PdfSnapshotJob } from '../workers/pdf-snapshot'
import { PdfSnapshotServiceError } from '../services/pdf-snapshot-service'

type SubmissionRow = {
  id: string
  status: string
  organizationId: string
  tenantId: string
  pdfSnapshotAttachmentId: string | null
}

function makeJob(payload: PdfSnapshotJob): QueuedJob<PdfSnapshotJob> {
  return { id: 'job-1', payload, createdAt: new Date().toISOString() }
}

function makeCtx(args: {
  submission: SubmissionRow | null
  ensureSnapshot: jest.Mock
}): JobContext & { resolve: <T = unknown>(name: string) => T } {
  const em = {
    fork: () => em,
    findOne: async (_entity: unknown, where: { id: string }) =>
      args.submission && args.submission.id === where.id ? args.submission : null,
  } as unknown as EntityManager
  const service = { ensureSnapshot: args.ensureSnapshot }
  const resolve = (<T,>(name: string): T => {
    if (name === 'em') return em as unknown as T
    if (name === 'formsPdfSnapshotService') return service as unknown as T
    throw new Error(`unexpected resolve(${name})`)
  }) as <T = unknown>(name: string) => T
  return { jobId: 'job-1', attemptNumber: 1, queueName: 'forms-pdf-snapshot', resolve }
}

const payload: PdfSnapshotJob = {
  submissionId: 'sub-1',
  organizationId: 'org-1',
  tenantId: 'tenant-1',
}

describe('forms pdf-snapshot worker', () => {
  it('generates when the submission is submitted and not yet snapshotted', async () => {
    const ensureSnapshot = jest.fn(async () => ({}))
    const ctx = makeCtx({
      submission: { id: 'sub-1', status: 'submitted', organizationId: 'org-1', tenantId: 'tenant-1', pdfSnapshotAttachmentId: null },
      ensureSnapshot,
    })
    await handle(makeJob(payload), ctx)
    expect(ensureSnapshot).toHaveBeenCalledTimes(1)
    expect(ensureSnapshot).toHaveBeenCalledWith({
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      submissionId: 'sub-1',
    })
  })

  it('is idempotent: no-op when a snapshot already exists', async () => {
    const ensureSnapshot = jest.fn()
    const ctx = makeCtx({
      submission: { id: 'sub-1', status: 'submitted', organizationId: 'org-1', tenantId: 'tenant-1', pdfSnapshotAttachmentId: 'att-1' },
      ensureSnapshot,
    })
    await handle(makeJob(payload), ctx)
    expect(ensureSnapshot).not.toHaveBeenCalled()
  })

  it('no-ops when the submission is not submitted', async () => {
    const ensureSnapshot = jest.fn()
    const ctx = makeCtx({
      submission: { id: 'sub-1', status: 'draft', organizationId: 'org-1', tenantId: 'tenant-1', pdfSnapshotAttachmentId: null },
      ensureSnapshot,
    })
    await handle(makeJob(payload), ctx)
    expect(ensureSnapshot).not.toHaveBeenCalled()
  })

  it('no-ops when the submission is missing / cross-tenant', async () => {
    const ensureSnapshot = jest.fn()
    const ctx = makeCtx({ submission: null, ensureSnapshot })
    await handle(makeJob(payload), ctx)
    expect(ensureSnapshot).not.toHaveBeenCalled()
  })

  it('swallows terminal PdfSnapshotServiceError (no retry)', async () => {
    const ensureSnapshot = jest.fn(async () => {
      throw new PdfSnapshotServiceError('NOT_SUBMITTED', 'nope', 409)
    })
    const ctx = makeCtx({
      submission: { id: 'sub-1', status: 'submitted', organizationId: 'org-1', tenantId: 'tenant-1', pdfSnapshotAttachmentId: null },
      ensureSnapshot,
    })
    await expect(handle(makeJob(payload), ctx)).resolves.toBeUndefined()
  })

  it('re-throws unknown errors so the queue retries', async () => {
    const ensureSnapshot = jest.fn(async () => {
      throw new Error('transient db error')
    })
    const ctx = makeCtx({
      submission: { id: 'sub-1', status: 'submitted', organizationId: 'org-1', tenantId: 'tenant-1', pdfSnapshotAttachmentId: null },
      ensureSnapshot,
    })
    await expect(handle(makeJob(payload), ctx)).rejects.toThrow('transient db error')
  })

  it('rejects a payload missing required scope fields', async () => {
    const ensureSnapshot = jest.fn()
    const ctx = makeCtx({ submission: null, ensureSnapshot })
    await expect(
      handle(makeJob({ submissionId: 'sub-1' } as unknown as PdfSnapshotJob), ctx),
    ).rejects.toThrow('forms-pdf-snapshot requires submissionId, organizationId and tenantId')
  })
})
