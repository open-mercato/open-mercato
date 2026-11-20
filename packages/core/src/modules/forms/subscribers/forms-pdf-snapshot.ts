/**
 * W3 (T7) — signed-PDF snapshot dispatch on submit.
 *
 * Reacts to `forms.submission.submitted` and ENQUEUES a job on the
 * `forms-pdf-snapshot` queue so the (CPU-heavy, pdf-lib) render runs off the
 * submit request path in a dedicated worker (`workers/pdf-snapshot.ts`). The
 * `PdfSnapshotService` is idempotent (skips when `pdf_snapshot_attachment_id`
 * is set), so at-least-once delivery is safe.
 *
 * Fail-soft + degradation ladder:
 *   1. Enqueue on the queue (preferred — off the request path).
 *   2. If enqueueing throws (queue misconfigured / unavailable), fall back to
 *      inline generation so a snapshot is still produced.
 *   3. If inline generation also fails, log + swallow — the snapshot is also
 *      generated lazily on first download, so submit never breaks.
 *
 * Org/tenant scope is re-derived from the persisted submission row (never from
 * the event payload, which is id-only by catalog construction).
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { createQueue, resolveQueueStrategy } from '@open-mercato/queue'
import { FormSubmission } from '../data/entities'
import type { PdfSnapshotService } from '../services/pdf-snapshot-service'
import { PDF_SNAPSHOT_QUEUE_NAME, type PdfSnapshotJob } from '../workers/pdf-snapshot'

export const metadata = {
  event: 'forms.submission.submitted',
  persistent: true,
  id: 'forms.pdf-snapshot.submitted',
}

type ResolveContainer = {
  resolve: <T = unknown>(key: string) => T
}

type SubscriberContext = {
  container: ResolveContainer
}

type SubmissionSubmittedPayload = {
  submissionId: string
}

type Logger = {
  warn: (data: Record<string, unknown>, message: string) => void
}

export default async function handleSubmissionSubmitted(
  payload: SubmissionSubmittedPayload,
  ctx: SubscriberContext,
): Promise<void> {
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const submission = await em.findOne(FormSubmission, {
    id: payload.submissionId,
    deletedAt: null,
  })
  if (!submission || submission.status !== 'submitted') return
  if (submission.pdfSnapshotAttachmentId) return

  const job: PdfSnapshotJob = {
    submissionId: submission.id,
    organizationId: submission.organizationId,
    tenantId: submission.tenantId,
  }

  try {
    const queue = createQueue<PdfSnapshotJob>(PDF_SNAPSHOT_QUEUE_NAME, resolveQueueStrategy())
    await queue.enqueue(job)
    return
  } catch (error) {
    tryResolveLogger(ctx.container)?.warn(
      {
        event: 'forms.pdf_snapshot.enqueue_failed',
        submissionId: payload.submissionId,
        message: error instanceof Error ? error.message : 'Unknown enqueue error',
      },
      'forms PDF snapshot enqueue failed (falling back to inline generation)',
    )
  }

  // Fallback: queue unavailable — generate inline so a snapshot is still made.
  try {
    const service = ctx.container.resolve('formsPdfSnapshotService') as PdfSnapshotService
    await service.ensureSnapshot({
      organizationId: submission.organizationId,
      tenantId: submission.tenantId,
      submissionId: submission.id,
    })
  } catch (error) {
    tryResolveLogger(ctx.container)?.warn(
      {
        event: 'forms.pdf_snapshot.generation_failed',
        submissionId: payload.submissionId,
        message: error instanceof Error ? error.message : 'Unknown snapshot error',
      },
      'forms PDF snapshot inline fallback failed (will retry on download)',
    )
  }
}

function tryResolveLogger(container: ResolveContainer): Logger | null {
  try {
    const resolved = container.resolve('logger')
    if (resolved && typeof (resolved as { warn?: unknown }).warn === 'function') {
      return resolved as Logger
    }
  } catch {
    /* logger is optional */
  }
  return null
}
