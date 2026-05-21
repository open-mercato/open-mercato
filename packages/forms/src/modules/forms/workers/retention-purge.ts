/**
 * W5 (DP-6 / DP-11) — retention purge worker.
 *
 * For a given tenant + organization, finds form submissions whose age has
 * exceeded their form's `retention_days` window and ANONYMIZES them (reuses
 * `AnonymizeService` — never a hard delete, so the append-only revision +
 * audit chain survives). Idempotent: already-anonymized submissions are
 * skipped both by the eligibility check and by the AnonymizeService itself.
 *
 * Scheduling: this worker is enqueued on the `forms-retention-purge` queue.
 * Wire a daily trigger via the `scheduler` module (a `scheduler.job` with
 * `targetType = 'queue'`, `targetQueue = 'forms-retention-purge'`, and a
 * `{ scope: { organizationId, tenantId } }` payload) when that module is
 * enabled; otherwise enqueue manually:
 *
 *   yarn mercato forms worker forms-retention-purge
 *
 * PII safety: logs only counts, form ids, and submission ids — never decoded
 * answer values. Anonymization happens entirely inside AnonymizeService.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { Form, FormSubmission, FormVersion } from '../data/entities'
import type { AnonymizeService } from '../services/anonymize-service'
import { decideRetention } from '../lib/retention'
import { emitFormsEvent } from '../events'

export const metadata: WorkerMeta = {
  queue: 'forms-retention-purge',
  id: 'forms:retention-purge',
  concurrency: 1,
}

export type RetentionPurgePayload = {
  scope: {
    organizationId: string
    tenantId: string
  }
  /** Override the per-run batch size (default 200). */
  batchSize?: number
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

const DEFAULT_BATCH_SIZE = 200

export default async function handle(
  job: QueuedJob<RetentionPurgePayload>,
  ctx: HandlerContext,
): Promise<void> {
  const payload = (job.payload ??
    (job as unknown as { data?: RetentionPurgePayload }).data) as
    | RetentionPurgePayload
    | undefined
  const scope = payload?.scope
  if (!scope?.organizationId || !scope?.tenantId) {
    throw new Error('forms-retention-purge requires scope.organizationId and scope.tenantId')
  }

  const em = ctx.resolve<EntityManager>('em')
  const anonymizeService = ctx.resolve<AnonymizeService>('formsAnonymizeService')
  const batchSize = clampBatchSize(payload?.batchSize)
  const now = new Date()

  // Forms with a retention window, scoped to this tenant/org.
  const forms = await em.find(Form, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    retentionDays: { $ne: null },
    deletedAt: null,
  })
  if (forms.length === 0) return

  const retentionByFormId = new Map<string, number>()
  for (const form of forms) {
    if (form.retentionDays != null && form.retentionDays > 0) {
      retentionByFormId.set(form.id, form.retentionDays)
    }
  }
  if (retentionByFormId.size === 0) return

  // Map every published/draft version back to its form so a submission
  // (pinned to a version) can look up the form's retention window.
  const versions = await em.find(FormVersion, {
    formId: { $in: Array.from(retentionByFormId.keys()) },
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  const formIdByVersionId = new Map<string, string>()
  for (const version of versions) {
    formIdByVersionId.set(version.id, version.formId)
  }
  if (formIdByVersionId.size === 0) return

  let scanned = 0
  let purged = 0
  let revisionsAnonymized = 0
  let offset = 0

  // Batched scan of candidate submissions (not yet anonymized, scoped).
  for (;;) {
    const submissions = await em.find(
      FormSubmission,
      {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        formVersionId: { $in: Array.from(formIdByVersionId.keys()) },
        anonymizedAt: null,
        deletedAt: null,
      },
      { orderBy: { firstSavedAt: 'asc' }, limit: batchSize, offset },
    )
    if (submissions.length === 0) break

    for (const submission of submissions) {
      scanned += 1
      const formId = formIdByVersionId.get(submission.formVersionId)
      const retentionDays = formId ? retentionByFormId.get(formId) ?? null : null
      const decision = decideRetention({
        submission: {
          submittedAt: submission.submittedAt ?? null,
          updatedAt: submission.updatedAt,
          anonymizedAt: submission.anonymizedAt ?? null,
        },
        retentionDays,
        now,
      })
      if (!decision.eligible) continue
      const result = await anonymizeService.anonymize(submission.id)
      purged += 1
      revisionsAnonymized += result.revisionsAnonymized
      await emitFormsEvent('forms.submission.anonymized', { submissionId: submission.id })
    }

    if (submissions.length < batchSize) break
    offset += batchSize
  }

  if (purged > 0) {
    console.info('[forms:retention-purge] completed', {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      formsWithRetention: retentionByFormId.size,
      scanned,
      purged,
      revisionsAnonymized,
    })
  }
}

function clampBatchSize(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return DEFAULT_BATCH_SIZE
  const normalized = Math.floor(value)
  if (normalized < 1) return 1
  if (normalized > 1000) return 1000
  return normalized
}
