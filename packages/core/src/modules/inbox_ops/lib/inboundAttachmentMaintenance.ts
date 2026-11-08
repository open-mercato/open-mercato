import type { EntityManager } from '@mikro-orm/postgresql'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { listUnguardedAttachmentReaders } from '@open-mercato/core/modules/attachments'
import { completeDeletedInboundAttachmentIngest } from './inboundAttachmentIngest'
import { releaseInboundEmailAttachments, type InboundAttachmentReleaseService } from './inboundAttachmentRelease'
import {
  readInboundAttachmentsConfigOrDefaults,
  reenqueueInboundAttachmentIngest,
  reportInboundAttachmentError,
  warnIfStoredInboundAttachmentsReadableByUnguardedReaders,
  type InboundAttachmentEmailRef,
  type InboundAttachmentIngestEnqueuer,
} from './inboundAttachments'
import type { InboundAttachmentsConfig } from './inboundAttachmentsConfig'

/**
 * The maintenance sweep (spec "Maintenance"): a safety net that re-enqueues stranded ingests,
 * completes ingests of deleted emails and retries releases. It never finalizes an email; only the
 * ingest worker does, after a run that attempted every remaining part.
 */

const logger = createLogger('inbox_ops').child({ component: 'attachment-maintenance' })

export const INBOX_OPS_ATTACHMENT_MAINTENANCE_QUEUE = 'inbox-ops-attachment-maintenance'
/** A current job is stranded only this long after it was due, so waiting jobs are never multiplied. */
export const INBOX_OPS_ATTACHMENT_STRANDED_AFTER_MS = 15 * 60 * 1000
export const INBOX_OPS_ATTACHMENT_SWEEP_BATCH = 100

type EmailRow = { id: string; tenant_id: string; organization_id: string }

function toRef(row: EmailRow): InboundAttachmentEmailRef {
  return { id: row.id, tenantId: row.tenant_id, organizationId: row.organization_id }
}

const STRANDED_INBOUND_ATTACHMENT_EMAIL_PREDICATE_SQL = `deleted_at is null
   and (
     (attachments_status = 'pending'
       and (attachments_next_run_at is null or attachments_next_run_at < ?))
     or (attachments_status = 'processing'
       and (attachments_claimed_at is null or attachments_claimed_at < ?)
       and (attachments_next_run_at is null or attachments_next_run_at < ?))
   )
 order by attachments_next_run_at asc nulls first, id asc
 limit ?`

/**
 * Stranded: not soft-deleted, and `pending` with `attachments_next_run_at` older than 15 minutes,
 * or `processing` past its lease with `attachments_next_run_at` older than 15 minutes.
 * Parameters: next-run cutoff, lease cutoff, next-run cutoff, limit.
 */
export const SELECT_STRANDED_INBOUND_ATTACHMENT_EMAILS_SQL = `select id, tenant_id, organization_id
  from inbox_emails
 where ${STRANDED_INBOUND_ATTACHMENT_EMAIL_PREDICATE_SQL}`

/**
 * The stranded emails of one inbox (the webhook catch-up). Parameters: tenant id, organization id,
 * next-run cutoff, lease cutoff, next-run cutoff, limit.
 */
export const SELECT_STRANDED_INBOUND_ATTACHMENT_EMAILS_IN_SCOPE_SQL = `select id, tenant_id, organization_id
  from inbox_emails
 where tenant_id = ? and organization_id = ?
   and ${STRANDED_INBOUND_ATTACHMENT_EMAIL_PREDICATE_SQL}`

export const SELECT_DELETED_OPEN_INBOUND_ATTACHMENT_EMAILS_SQL = `select id, tenant_id, organization_id
  from inbox_emails
 where deleted_at is not null
   and attachments_status in ('pending', 'processing')
 order by deleted_at asc, id asc
 limit ?`

/** Matches the partial release-pending index; emails deleted before the upgrade have neither column set. */
export const SELECT_UNRELEASED_DELETED_INBOUND_EMAILS_SQL = `select id, tenant_id, organization_id
  from inbox_emails
 where deleted_at is not null
   and attachments_released_at is null
   and (attachments_status is not null or attachments_release_requested_at is not null)
 order by deleted_at asc, id asc
 limit ?`

export type InboundAttachmentMaintenanceDeps = {
  em: EntityManager
  attachmentService?: InboundAttachmentReleaseService | null
  encryptionService?: Pick<TenantDataEncryptionService, 'encryptEntityPayload'> | null
  queue?: InboundAttachmentIngestEnqueuer
  config?: Pick<InboundAttachmentsConfig, 'leaseMs'>
  listUnguardedReaders?: () => string[]
  now?: () => Date
}

export type InboundAttachmentMaintenanceResult = {
  completedDeleted: number
  reenqueued: number
  requeueFailed: number
  released: number
  releaseDeferred: number
  storedReadableByUnguardedReader: boolean
}

async function selectEmails(em: EntityManager, sql: string, params: unknown[]): Promise<InboundAttachmentEmailRef[]> {
  const rows = await em.getConnection().execute<EmailRow[]>(sql, params)
  return Array.isArray(rows) ? rows.map(toRef) : []
}

export async function runInboundAttachmentMaintenance(
  deps: InboundAttachmentMaintenanceDeps,
): Promise<InboundAttachmentMaintenanceResult> {
  const { em } = deps
  const now = deps.now ?? (() => new Date())
  const leaseMs = (deps.config ?? readInboundAttachmentsConfigOrDefaults()).leaseMs
  const result: InboundAttachmentMaintenanceResult = {
    completedDeleted: 0,
    reenqueued: 0,
    requeueFailed: 0,
    released: 0,
    releaseDeferred: 0,
    storedReadableByUnguardedReader: false,
  }

  try {
    const deletedOpen = await selectEmails(em, SELECT_DELETED_OPEN_INBOUND_ATTACHMENT_EMAILS_SQL, [INBOX_OPS_ATTACHMENT_SWEEP_BATCH])
    for (const email of deletedOpen) {
      if (await completeDeletedInboundAttachmentIngest(em, email)) result.completedDeleted += 1
    }
  } catch (error) {
    logger.error('Failed to complete the ingests of deleted inbound emails', { err: error })
    reportInboundAttachmentError(error, 'inbox_ops.attachment_requeue_failed', { step: 'complete_deleted' })
  }

  try {
    const timestamp = now().getTime()
    const nextRunCutoff = new Date(timestamp - INBOX_OPS_ATTACHMENT_STRANDED_AFTER_MS)
    const leaseCutoff = new Date(timestamp - leaseMs)
    const stranded = await selectEmails(em, SELECT_STRANDED_INBOUND_ATTACHMENT_EMAILS_SQL, [
      nextRunCutoff,
      leaseCutoff,
      nextRunCutoff,
      INBOX_OPS_ATTACHMENT_SWEEP_BATCH,
    ])
    for (const email of stranded) {
      const requeued = await reenqueueInboundAttachmentIngest({ em, email, queue: deps.queue, now })
      if (requeued.kind === 'enqueued') {
        result.reenqueued += 1
      } else if (requeued.kind === 'enqueue_failed') {
        result.requeueFailed += 1
        logger.error('Failed to re-enqueue a stranded inbound attachment ingest', { emailId: email.id })
        reportInboundAttachmentError(requeued.error, 'inbox_ops.attachment_requeue_failed', {
          emailId: email.id,
          tenantId: email.tenantId,
        })
      }
    }
  } catch (error) {
    logger.error('Failed to re-enqueue stranded inbound attachment ingests', { err: error })
    reportInboundAttachmentError(error, 'inbox_ops.attachment_requeue_failed', { step: 'stranded' })
  }

  if (deps.attachmentService) {
    try {
      const unreleased = await selectEmails(em, SELECT_UNRELEASED_DELETED_INBOUND_EMAILS_SQL, [INBOX_OPS_ATTACHMENT_SWEEP_BATCH])
      for (const email of unreleased) {
        try {
          const released = await releaseInboundEmailAttachments({
            em,
            email,
            attachmentService: deps.attachmentService,
            encryptionService: deps.encryptionService,
            now,
          })
          if (released.fullyReleased) result.released += 1
          else result.releaseDeferred += 1
        } catch (error) {
          result.releaseDeferred += 1
          logger.warn('Failed to release the attachments of a deleted inbound email', { emailId: email.id, err: error })
          reportInboundAttachmentError(error, 'inbox_ops.attachment_release_failed', { emailId: email.id })
        }
      }
    } catch (error) {
      logger.error('Failed to select deleted inbound emails awaiting release', { err: error })
      reportInboundAttachmentError(error, 'inbox_ops.attachment_release_failed', { step: 'select' })
    }
  }

  try {
    const readers = (deps.listUnguardedReaders ?? listUnguardedAttachmentReaders)()
    result.storedReadableByUnguardedReader = await warnIfStoredInboundAttachmentsReadableByUnguardedReaders(em, readers, now)
  } catch (error) {
    logger.warn('Failed to check stored inbound attachments against unguarded readers', { err: error })
  }

  return result
}
