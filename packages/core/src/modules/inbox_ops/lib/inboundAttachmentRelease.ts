import { raw } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { AttachmentService } from '@open-mercato/core/modules/attachments'
import { E } from '#generated/entities.ids.generated'
import { InboxEmail, InboxEmailAttachment } from '../data/entities'
import {
  INBOUND_ATTACHMENT_OWNER_ENTITY_ID,
  reportInboundAttachmentError,
  type InboundAttachmentEmailRef,
} from './inboundAttachments'

const logger = createLogger('inbox_ops').child({ component: 'attachment-release' })

export type InboundAttachmentReleaseService = Pick<AttachmentService, 'releaseScoped' | 'releaseOwnedScoped'>

export type ReleaseInboundEmailAttachmentsInput = {
  em: EntityManager
  /** A soft-deleted email. */
  email: InboundAttachmentEmailRef
  /** Resolved softly; without it the release is deferred and the email stays in the resolver's deny set. */
  attachmentService?: InboundAttachmentReleaseService | null
  encryptionService?: Pick<TenantDataEncryptionService, 'encryptEntityPayload'> | null
  now?: () => Date
}

export type ReleaseInboundEmailAttachmentsResult = {
  /** Every ledger row is `released` and no attachment row references the email any more. */
  fullyReleased: boolean
  /** `attachments_released_at` was written by this call. */
  markedReleased: boolean
  releasedParts: number
  remainingParts: number
  deferred: boolean
}

type ReleaseOutcome = 'released' | 'still_referenced' | 'failed'

/**
 * The single update a deletion makes on the email row: the soft delete, the release request (on
 * every deletion, so rows planted under any email are covered) and the invalidation of any ingest
 * claim, with `attachments_status` set to `completed` only when it was not null. Its row lock
 * serializes with the ingest worker's claim renewal. Leaves `updated_at` unchanged.
 */
export async function softDeleteInboxEmailForRelease(
  em: EntityManager,
  email: InboundAttachmentEmailRef,
  now: Date = new Date(),
): Promise<boolean> {
  const updated = await em.nativeUpdate(
    InboxEmail,
    { id: email.id, organizationId: email.organizationId, tenantId: email.tenantId, deletedAt: null },
    {
      deletedAt: now,
      attachmentsReleaseRequestedAt: now,
      attachmentsClaimToken: null,
      attachmentsStatus: raw(`case when "attachments_status" is null then null else 'completed' end`),
    },
  )
  return updated > 0
}

function errorStatus(error: unknown): number | null {
  return isCrudHttpError(error) ? error.status : null
}

async function clearedLedgerColumns(
  encryptionService: ReleaseInboundEmailAttachmentsInput['encryptionService'],
  email: InboundAttachmentEmailRef,
): Promise<{ fileName: string | null; extractedText: string | null }> {
  const cleared = { fileName: null, extractedText: null }
  if (!encryptionService) return cleared
  const encrypted = await encryptionService.encryptEntityPayload(
    E.inbox_ops.inbox_email_attachment,
    cleared,
    email.tenantId,
    email.organizationId,
  )
  return {
    fileName: typeof encrypted.fileName === 'string' ? encrypted.fileName : null,
    extractedText: typeof encrypted.extractedText === 'string' ? encrypted.extractedText : null,
  }
}

async function releaseStoredPart(
  service: InboundAttachmentReleaseService,
  email: InboundAttachmentEmailRef,
  attachmentId: string,
): Promise<ReleaseOutcome> {
  if (typeof service.releaseScoped !== 'function') return 'still_referenced'
  const owner = { entityId: INBOUND_ATTACHMENT_OWNER_ENTITY_ID, recordId: email.id }
  try {
    await service.releaseScoped({
      attachmentId,
      tenantId: email.tenantId,
      organizationId: email.organizationId,
      expectedOwner: owner,
      expectedAssignment: { type: owner.entityId, id: owner.recordId },
    })
    return 'released'
  } catch (error) {
    const status = errorStatus(error)
    if (status === 404) return 'released'
    if (status === 409) return 'still_referenced'
    logger.warn('Failed to release a stored inbound attachment', { emailId: email.id, attachmentId, err: error })
    reportInboundAttachmentError(error, 'inbox_ops.attachment_release_failed', { emailId: email.id, attachmentId })
    return 'failed'
  }
}

/**
 * Releases the attachments of a soft-deleted email (spec "Release on deletion"). Ledger rows that
 * were never stored are marked `released` at once; each stored part is released through
 * `releaseScoped` with the owner assignment and marked `released` only after its own release
 * succeeded (a 404 counts as released); then `releaseOwnedScoped` removes the email's reference
 * from every other row, which also settles parts `releaseScoped` refused because other assignments
 * remain. `attachments_released_at` is set only when everything is released. Names and texts are
 * cleared on every released row. Idempotent: the maintenance sweep retries it until it succeeds.
 */
export async function releaseInboundEmailAttachments(
  input: ReleaseInboundEmailAttachmentsInput,
): Promise<ReleaseInboundEmailAttachmentsResult> {
  const { em, email } = input
  const now = input.now ?? (() => new Date())
  const scope = { tenantId: email.tenantId, organizationId: email.organizationId }
  const ledgerScope = { inboxEmailId: email.id, tenantId: email.tenantId, organizationId: email.organizationId }
  const cleared = await clearedLedgerColumns(input.encryptionService, email)

  await em.nativeUpdate(
    InboxEmailAttachment,
    { ...ledgerScope, status: { $in: ['pending', 'skipped', 'failed'] } },
    { status: 'released', ...cleared, inFlightAt: null, updatedAt: now() },
  )

  const stored = await findWithDecryption(
    em,
    InboxEmailAttachment,
    { ...ledgerScope, status: 'stored' },
    { refresh: true },
    scope,
  )

  const service = input.attachmentService ?? null
  if (!service) {
    return { fullyReleased: false, markedReleased: false, releasedParts: 0, remainingParts: stored.length, deferred: true }
  }

  const markReleased = async (rowId: string) => {
    await em.nativeUpdate(
      InboxEmailAttachment,
      { ...ledgerScope, id: rowId, status: 'stored' },
      { status: 'released', ...cleared, inFlightAt: null, updatedAt: now() },
    )
  }

  let releasedParts = 0
  const awaitingOwnedRelease: string[] = []
  let failed = false
  for (const row of stored) {
    if (!row.attachmentId) {
      awaitingOwnedRelease.push(row.id)
      continue
    }
    const outcome = await releaseStoredPart(service, email, row.attachmentId)
    if (outcome === 'released') {
      await markReleased(row.id)
      releasedParts += 1
    } else if (outcome === 'still_referenced') {
      awaitingOwnedRelease.push(row.id)
    } else {
      failed = true
    }
  }

  let ownedReleased = false
  if (typeof service.releaseOwnedScoped === 'function') {
    try {
      await service.releaseOwnedScoped({
        owner: { entityId: INBOUND_ATTACHMENT_OWNER_ENTITY_ID, recordId: email.id },
        tenantId: email.tenantId,
        organizationId: email.organizationId,
      })
      ownedReleased = true
    } catch (error) {
      logger.warn('Failed to release the attachments referencing a deleted inbound email', { emailId: email.id, err: error })
      reportInboundAttachmentError(error, 'inbox_ops.attachment_release_failed', { emailId: email.id })
    }
  }

  if (ownedReleased) {
    for (const rowId of awaitingOwnedRelease) {
      await markReleased(rowId)
      releasedParts += 1
    }
  }

  const remainingParts = stored.length - releasedParts
  const fullyReleased = ownedReleased && !failed && remainingParts === 0
  let markedReleased = false
  if (fullyReleased) {
    const updated = await em.nativeUpdate(
      InboxEmail,
      { id: email.id, tenantId: email.tenantId, organizationId: email.organizationId, deletedAt: { $ne: null }, attachmentsReleasedAt: null },
      { attachmentsReleasedAt: now() },
    )
    markedReleased = updated > 0
  }
  return { fullyReleased, markedReleased, releasedParts, remainingParts, deferred: false }
}
