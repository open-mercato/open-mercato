/**
 * W3 (T7) — signed-PDF snapshot generation worker.
 *
 * Moves snapshot rendering off the submit request path. The
 * `forms.submission.submitted` subscriber enqueues a `{ submissionId,
 * organizationId, tenantId }` job on the `forms-pdf-snapshot` queue; this
 * worker loads the submission (tenant-scoped) and calls the existing,
 * idempotent `PdfSnapshotService.ensureSnapshot(...)`.
 *
 * Idempotency: `ensureSnapshot` is a no-op once `pdf_snapshot_attachment_id`
 * is set (submissions are immutable post-submit). The same guard holds across
 * the worker and the lazy on-download path in the PDF routes, so at-least-once
 * delivery + a concurrent download can never double-generate.
 *
 * Fail-soft: a render/store failure is logged and swallowed for non-submitted /
 * missing rows; genuine transient errors re-throw so the queue can retry. The
 * snapshot also generates lazily on first download, so a permanently failing
 * job never blocks an admin/participant from obtaining the PDF.
 *
 * Org/tenant scope is taken from the job payload but re-validated against the
 * persisted submission row (every `ensureSnapshot` query is scoped by
 * org + tenant), so a forged payload cannot cross tenants.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { FormSubmission } from '../data/entities'
import { PdfSnapshotService, PdfSnapshotServiceError } from '../services/pdf-snapshot-service'

export const PDF_SNAPSHOT_QUEUE_NAME = 'forms-pdf-snapshot'

export const metadata: WorkerMeta = {
  queue: PDF_SNAPSHOT_QUEUE_NAME,
  id: 'forms:pdf-snapshot',
  concurrency: 1,
}

export type PdfSnapshotJob = {
  submissionId: string
  organizationId: string
  tenantId: string
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

type Logger = {
  warn: (data: Record<string, unknown>, message: string) => void
}

export default async function handle(
  job: QueuedJob<PdfSnapshotJob>,
  ctx: HandlerContext,
): Promise<void> {
  const payload = (job.payload ??
    (job as unknown as { data?: PdfSnapshotJob }).data) as PdfSnapshotJob | undefined
  if (!payload?.submissionId || !payload?.organizationId || !payload?.tenantId) {
    throw new Error('forms-pdf-snapshot requires submissionId, organizationId and tenantId')
  }

  const em = ctx.resolve<EntityManager>('em').fork()
  const submission = await em.findOne(FormSubmission, {
    id: payload.submissionId,
    organizationId: payload.organizationId,
    tenantId: payload.tenantId,
    deletedAt: null,
  })
  // Not-yet-submitted / missing / not-this-tenant: nothing to snapshot. No retry.
  if (!submission || submission.status !== 'submitted') return
  // Idempotency guard — snapshot already produced (worker or lazy download).
  if (submission.pdfSnapshotAttachmentId) return

  const service = ctx.resolve<PdfSnapshotService>('formsPdfSnapshotService')
  try {
    await service.ensureSnapshot({
      organizationId: payload.organizationId,
      tenantId: payload.tenantId,
      submissionId: payload.submissionId,
    })
  } catch (error) {
    // Expected service-state errors (not-found / not-submitted) are terminal —
    // swallow so the job does not retry forever; lazy download still works.
    if (error instanceof PdfSnapshotServiceError) {
      tryResolveLogger(ctx)?.warn(
        {
          event: 'forms.pdf_snapshot.worker_skipped',
          submissionId: payload.submissionId,
          code: error.code,
        },
        'forms PDF snapshot worker skipped (will generate on download)',
      )
      return
    }
    // Unknown / transient failure — re-throw so the queue retries the job.
    throw error
  }
}

function tryResolveLogger(ctx: HandlerContext): Logger | null {
  try {
    const resolved = ctx.resolve('logger')
    if (resolved && typeof (resolved as { warn?: unknown }).warn === 'function') {
      return resolved as Logger
    }
  } catch {
    /* logger is optional */
  }
  return null
}
