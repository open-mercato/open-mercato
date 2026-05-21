/**
 * W3 — signed-PDF snapshot generation on submit.
 *
 * Reacts to `forms.submission.submitted` and renders the immutable PDF
 * snapshot, storing it as an encrypted `forms_form_attachment`
 * (`kind = 'snapshot'`) linked via `pdf_snapshot_attachment_id`. The
 * `PdfSnapshotService` is idempotent (skips when the link is already set), so
 * at-least-once delivery is safe.
 *
 * Fail-soft: a render/store failure is logged and swallowed — the snapshot is
 * also generated lazily on first download (admin/public PDF endpoints call
 * `ensureSnapshot`), so a transient failure here never blocks the submission
 * lifecycle. `persistent: true` lets the queue retry.
 *
 * Org/tenant scope is re-derived from the persisted submission row (never from
 * the event payload, which is id-only by catalog construction).
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { FormSubmission } from '../data/entities'
import type { PdfSnapshotService } from '../services/pdf-snapshot-service'

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

  try {
    const service = ctx.container.resolve('formsPdfSnapshotService') as PdfSnapshotService
    await service.ensureSnapshot({
      organizationId: submission.organizationId,
      tenantId: submission.tenantId,
      submissionId: submission.id,
    })
  } catch (error) {
    const logger = tryResolveLogger(ctx.container)
    logger?.warn(
      {
        event: 'forms.pdf_snapshot.generation_failed',
        submissionId: payload.submissionId,
        message: error instanceof Error ? error.message : 'Unknown snapshot error',
      },
      'forms PDF snapshot generation failed (will retry on download)',
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
