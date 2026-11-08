import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  InboxEmail,
  InboxEmailAttachment,
  type InboxEmailAttachmentReason,
} from '../data/entities'
import { readInboundAttachmentsConfigOrDefaults, type InboundAttachmentEmailRef } from './inboundAttachments'
import type { InboundAttachmentsConfig } from './inboundAttachmentsConfig'

/**
 * The manual ingest retry of `POST /api/inbox_ops/emails/[id]/reprocess` (spec "Manual retry").
 * Only emails with a non-null `attachments_status` are affected.
 */

/** Failure reasons an operator can fix (a rotated key, freed quota, a restored partition). */
export const RETRYABLE_INBOUND_ATTACHMENT_FAILURE_REASONS = [
  'ingest_timeout',
  'quota_exceeded',
  'partition_unavailable',
] as const satisfies readonly InboxEmailAttachmentReason[]

/**
 * - `not_applicable`: the route behaves as before.
 * - `live_lease`: a worker holds a live claim; 409.
 * - `requeue_ingest`: a waiting or stranded ingest (`pending`, or `processing` with an expired lease).
 * - `retry_failed_parts`: a finalized ingest with parts failed for an operator-fixable reason.
 */
export type InboundAttachmentReprocessPlan = 'not_applicable' | 'live_lease' | 'requeue_ingest' | 'retry_failed_parts'

type ReprocessCandidate = Pick<
  InboxEmail,
  'id' | 'tenantId' | 'organizationId' | 'status' | 'attachmentsStatus' | 'attachmentsClaimedAt'
>

function isQueuedForExtraction(email: Pick<InboxEmail, 'status'>): boolean {
  return email.status === 'received' || email.status === 'processing'
}

export async function countRetryableFailedInboundParts(em: EntityManager, ref: InboundAttachmentEmailRef): Promise<number> {
  return em.count(InboxEmailAttachment, {
    inboxEmailId: ref.id,
    tenantId: ref.tenantId,
    organizationId: ref.organizationId,
    status: 'failed',
    reason: { $in: [...RETRYABLE_INBOUND_ATTACHMENT_FAILURE_REASONS] },
    deletedAt: null,
  })
}

/**
 * The processing log's `attachmentsRetryable` for a page of emails (spec Phase 3), with one ledger
 * query (distinct email ids) for the whole page: an ingest that is `pending` or `processing`, or a finished one with at
 * least one part failed for an operator-fixable reason. The reprocess route still decides; a live
 * lease or running extraction is refused there.
 */
export async function resolveInboundAttachmentsRetryable(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  emails: ReadonlyArray<Pick<InboxEmail, 'id' | 'attachmentsStatus'>>,
): Promise<Map<string, boolean>> {
  const retryable = new Map<string, boolean>()
  const finished: string[] = []
  for (const email of emails) {
    const status = email.attachmentsStatus ?? null
    retryable.set(email.id, status === 'pending' || status === 'processing')
    if (status === 'completed') finished.push(email.id)
  }
  if (finished.length === 0) return retryable
  // Distinct email ids only: a ledger holds up to its row cap per email, and the columns read are plaintext.
  const rows = await em.getKysely<RetryableLedgerDb>()
    .selectFrom('inbox_email_attachments')
    .select('inbox_email_id')
    .distinct()
    .where('inbox_email_id', 'in', finished)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('status', '=', 'failed')
    .where('reason', 'in', [...RETRYABLE_INBOUND_ATTACHMENT_FAILURE_REASONS])
    .where('deleted_at', 'is', null)
    .execute()
  for (const row of rows) retryable.set(row.inbox_email_id, true)
  return retryable
}

type RetryableLedgerDb = {
  inbox_email_attachments: {
    inbox_email_id: string
    tenant_id: string
    organization_id: string
    status: string
    reason: string | null
    deleted_at: Date | null
  }
}

export async function planInboundAttachmentReprocess(
  em: EntityManager,
  email: ReprocessCandidate,
  options: { config?: Pick<InboundAttachmentsConfig, 'leaseMs'>; now?: () => Date } = {},
): Promise<InboundAttachmentReprocessPlan> {
  switch (email.attachmentsStatus) {
    case 'pending':
      return 'requeue_ingest'
    case 'processing': {
      const claimedAt = email.attachmentsClaimedAt
      if (!claimedAt) return 'requeue_ingest'
      const leaseMs = (options.config ?? readInboundAttachmentsConfigOrDefaults()).leaseMs
      const now = (options.now ?? (() => new Date()))()
      return claimedAt.getTime() < now.getTime() - leaseMs ? 'requeue_ingest' : 'live_lease'
    }
    case 'completed': {
      if (isQueuedForExtraction(email)) return 'not_applicable'
      const retryable = await countRetryableFailedInboundParts(em, email)
      return retryable > 0 ? 'retry_failed_parts' : 'not_applicable'
    }
    default:
      return 'not_applicable'
  }
}

/**
 * A waiting or stranded ingest gets a fresh 6-hour window. Conditional on `deleted_at is null`;
 * returns whether the email still exists. Leaves `updated_at` unchanged.
 */
export async function clearInboundAttachmentFirstFailure(em: EntityManager, ref: InboundAttachmentEmailRef): Promise<boolean> {
  const updated = await em.nativeUpdate(
    InboxEmail,
    { id: ref.id, tenantId: ref.tenantId, organizationId: ref.organizationId, deletedAt: null },
    { attachmentsFirstFailureAt: null },
  )
  return updated > 0
}

/**
 * Resets a finalized ingest for another run, inside the caller's transaction: the email goes back
 * to `received` with its ingest `pending` (conditional on `deleted_at is null` and
 * `attachments_status = 'completed'`, so a concurrent deletion or reprocess is never overwritten),
 * and its parts failed for an operator-fixable reason go back to `pending`. Permanently failed parts
 * and policy skips stay. Returns `false`, writing nothing, when the email update matched no row.
 */
export async function resetFinalizedInboundAttachmentIngest(
  em: EntityManager,
  ref: InboundAttachmentEmailRef,
  now: Date,
): Promise<boolean> {
  const updated = await em.nativeUpdate(
    InboxEmail,
    {
      id: ref.id,
      tenantId: ref.tenantId,
      organizationId: ref.organizationId,
      deletedAt: null,
      attachmentsStatus: 'completed',
    },
    {
      status: 'received',
      processingError: null,
      attachmentsStatus: 'pending',
      attachmentsClaimToken: null,
      attachmentsClaimedAt: null,
      attachmentsFirstFailureAt: null,
      attachmentsNextRunAt: now,
      updatedAt: now,
    },
  )
  if (updated === 0) return false
  await em.nativeUpdate(
    InboxEmailAttachment,
    {
      inboxEmailId: ref.id,
      tenantId: ref.tenantId,
      organizationId: ref.organizationId,
      status: 'failed',
      reason: { $in: [...RETRYABLE_INBOUND_ATTACHMENT_FAILURE_REASONS] },
      deletedAt: null,
    },
    { status: 'pending', reason: null, inFlightAt: null, updatedAt: now },
  )
  return true
}

/** Whether the email still exists and is not soft-deleted (404 versus 409 after a lost reset). */
export async function isLiveInboxEmail(em: EntityManager, ref: InboundAttachmentEmailRef): Promise<boolean> {
  const live = await em.count(InboxEmail, {
    id: ref.id,
    tenantId: ref.tenantId,
    organizationId: ref.organizationId,
    deletedAt: null,
  })
  return live > 0
}
