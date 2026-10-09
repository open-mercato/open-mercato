/**
 * Phase 3 Track D — consent-record projector.
 *
 * Reacts to `forms.submission.submitted` (id-only payload) and projects every
 * signed `signature`-typed answer into the `forms_consent_record` aggregate
 * via `ConsentRecordService`. For each signature field with a value it creates
 * a fresh `active` record and supersedes any prior `active` record for the
 * same subject + form + clause.
 *
 * Org/tenant scope is re-derived from the persisted submission row inside the
 * service (the event payload is id-only by catalog construction).
 *
 * Idempotent (the service no-ops when a record already exists for the
 * submission + field) and fail-soft: any error is logged + swallowed so a
 * projection failure never breaks the submit pipeline. The subscriber is
 * `persistent: true` so delivery is at-least-once.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { FormSubmission } from '../data/entities'
import type { ConsentRecordService } from '../services/consent-record-service'
import { emitFormsEvent } from '../events'
import { formsEventPayloadSchemas } from '../events-payloads'

export const metadata = {
  event: 'forms.submission.submitted',
  persistent: true,
  id: 'forms.consent-projector.submitted',
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
  try {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const submission = await em.findOne(FormSubmission, {
      id: payload.submissionId,
      deletedAt: null,
    })
    if (!submission || submission.status !== 'submitted') return

    const service = ctx.container.resolve('formsConsentRecordService') as ConsentRecordService
    const created = await service.projectFromSubmission({
      submissionId: submission.id,
      organizationId: submission.organizationId,
      tenantId: submission.tenantId,
    })

    for (const record of created) {
      await safeEmitConsentRecorded(record.id, submission.id)
    }
  } catch (error) {
    tryResolveLogger(ctx.container)?.warn(
      {
        event: 'forms.consent_projector.failed',
        submissionId: payload.submissionId,
        message: error instanceof Error ? error.message : 'Unknown projection error',
      },
      'forms consent projection failed (swallowed — submit pipeline unaffected)',
    )
  }
}

async function safeEmitConsentRecorded(recordId: string, submissionId: string): Promise<void> {
  try {
    const validated = formsEventPayloadSchemas['forms.consent.recorded'].parse({ recordId, submissionId })
    await emitFormsEvent('forms.consent.recorded', validated)
  } catch {
    /* event emission is best-effort — the record is already persisted */
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
