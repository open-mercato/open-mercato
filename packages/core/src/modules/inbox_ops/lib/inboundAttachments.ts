import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import type { AttachmentPersistLink, AttachmentService } from '@open-mercato/core/modules/attachments'
import { E } from '#generated/entities.ids.generated'
import {
  InboxEmail,
  InboxEmailAttachment,
  type InboxEmailAttachmentDisposition,
  type InboxEmailAttachmentReason,
  type InboxEmailAttachmentStatus,
} from '../data/entities'
import type { ResendInboundAttachment } from '../data/validators'
import type { InboundAttachmentsConfig } from './inboundAttachmentsConfig'

/**
 * Inbound email attachments of Resend mail (spec `2026-10-25-inbox-ops-inbound-attachments.md`):
 * decoration rule, part keys, file-name fallback, limits and the persistence of one downloaded
 * part. Internal to `inbox_ops`; not exported from the module index.
 */

export const INBOUND_ATTACHMENT_OWNER_ENTITY_ID = E.inbox_ops.inbox_email
export const INBOUND_ATTACHMENT_PARTITION_CODE = 'privateAttachments'

export const INBOX_CLAIM_LOST_CODE = 'inbox_claim_lost'
export const INBOX_PART_ALREADY_STORED_CODE = 'inbox_part_already_stored'

export type InboundAttachmentLimits = Pick<
  InboundAttachmentsConfig,
  'maxAttachments' | 'maxFileBytes' | 'maxTotalBytes' | 'inlineImageMinBytes'
>

export function inboundAttachmentPartKey(providerAttachmentId: string): string {
  return `resend:${providerAttachmentId}`
}

export function normalizeInboundDisposition(raw: string | null | undefined): InboxEmailAttachmentDisposition {
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'inline' ? 'inline' : 'attachment'
}

export function normalizeInboundContentType(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const normalized = raw.split(';')[0]?.trim().toLowerCase() ?? ''
  return normalized.length > 0 ? normalized : null
}

function hasContentId(part: ResendInboundAttachment): boolean {
  return typeof part.content_id === 'string' && part.content_id.trim().length > 0
}

/**
 * A part shown inside the body (a signature logo, a tracking pixel) rather than sent as a file:
 * inline, referenced by a `content_id`, and smaller than `INBOX_OPS_INLINE_IMAGE_MIN_BYTES`. A
 * null disposition counts as `attachment`; a larger inline image, such as a pasted photo, is kept.
 */
export function isDecorativeInboundPart(part: ResendInboundAttachment, inlineImageMinBytes: number): boolean {
  return normalizeInboundDisposition(part.content_disposition) === 'inline'
    && hasContentId(part)
    && part.size < inlineImageMinBytes
}

const EXTENSION_BY_CONTENT_TYPE: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/json': 'json',
  'application/xml': 'xml',
  'application/rtf': 'rtf',
  'application/msword': 'doc',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/tiff': 'tiff',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'text/html': 'html',
  'text/xml': 'xml',
  'text/calendar': 'ics',
  'message/rfc822': 'eml',
}

const FALLBACK_EXTENSION = 'bin'

/** Name of a part the sender left nameless: `attachment-<position>.<extension from its content type>`. */
export function fallbackInboundFileName(position: number, contentType: string | null | undefined): string {
  const extension = EXTENSION_BY_CONTENT_TYPE[normalizeInboundContentType(contentType) ?? ''] ?? FALLBACK_EXTENSION
  return `attachment-${position}.${extension}`
}

/** The sender's original name (kept for the encrypted ledger), or the fallback when it is blank. */
export function resolveInboundFileName(part: ResendInboundAttachment, position: number): string {
  const original = typeof part.filename === 'string' ? part.filename.trim() : ''
  return original.length > 0 ? original : fallbackInboundFileName(position, part.content_type)
}

/**
 * Name handed to `attachmentService.createScoped`, which ASCII-sanitizes it for storage. A
 * forwarded-as-attachment message (`message/rfc822`) is always stored as an `.eml` file.
 */
export function inboundUploadFileName(fileName: string, contentType: string | null | undefined): string {
  if (normalizeInboundContentType(contentType) !== 'message/rfc822') return fileName
  return fileName.toLowerCase().endsWith('.eml') ? fileName : `${fileName}.eml`
}

export type InboundAttachmentPolicyReason = Extract<
  InboxEmailAttachmentReason,
  'inline_decoration' | 'too_many' | 'too_large' | 'total_too_large'
>

/** One ledger row the webhook writes for a metadata entry. */
export type InboundAttachmentPartPlan = {
  partKey: string
  providerAttachmentId: string
  /** 1-based position in the provider's metadata list. */
  position: number
  fileName: string
  declaredMimeType: string | null
  sizeBytes: number
  contentId: string | null
  disposition: InboxEmailAttachmentDisposition
  status: Extract<InboxEmailAttachmentStatus, 'pending' | 'skipped'>
  reason: InboundAttachmentPolicyReason | null
}

/**
 * Applies the decoration rule and the limits on metadata, in this order: decoration
 * (`inline_decoration`), count (`too_many`), per-file size (`too_large`), total size
 * (`total_too_large`). Decorative parts never use up a slot. The total limit keeps every later
 * part that still fits. A repeated provider id is planned once (part keys are unique per email).
 */
export function planInboundAttachmentParts(
  parts: readonly ResendInboundAttachment[],
  limits: InboundAttachmentLimits,
): InboundAttachmentPartPlan[] {
  const seen = new Set<string>()
  const plans: InboundAttachmentPartPlan[] = []
  let countedParts = 0
  let acceptedBytes = 0
  parts.forEach((part, index) => {
    if (seen.has(part.id)) return
    seen.add(part.id)
    const position = index + 1
    let reason: InboundAttachmentPolicyReason | null = null
    if (isDecorativeInboundPart(part, limits.inlineImageMinBytes)) {
      reason = 'inline_decoration'
    } else {
      countedParts += 1
      if (countedParts > limits.maxAttachments) reason = 'too_many'
      else if (part.size > limits.maxFileBytes) reason = 'too_large'
      else if (acceptedBytes + part.size > limits.maxTotalBytes) reason = 'total_too_large'
      else acceptedBytes += part.size
    }
    plans.push({
      partKey: inboundAttachmentPartKey(part.id),
      providerAttachmentId: part.id,
      position,
      fileName: resolveInboundFileName(part, position),
      declaredMimeType: normalizeInboundContentType(part.content_type),
      sizeBytes: part.size,
      contentId: hasContentId(part) ? (part.content_id ?? null) : null,
      disposition: normalizeInboundDisposition(part.content_disposition),
      status: reason ? 'skipped' : 'pending',
      reason,
    })
  })
  return plans
}

/** Provider ids of the non-decorative parts; they enter `contentHash` (spec D13). */
export function nonDecorativeInboundAttachmentIds(
  parts: readonly ResendInboundAttachment[],
  limits: Pick<InboundAttachmentLimits, 'inlineImageMinBytes'>,
): string[] {
  return parts
    .filter((part) => !isDecorativeInboundPart(part, limits.inlineImageMinBytes))
    .map((part) => part.id)
}

/** Truncates to `maxChars` without splitting a surrogate pair; empty text becomes `null`. */
export function truncateInboundAttachmentText(text: string | null | undefined, maxChars: number): string | null {
  if (typeof text !== 'string' || text.length === 0) return null
  if (text.length <= maxChars) return text
  let end = Math.max(0, maxChars)
  const lastCode = text.charCodeAt(end - 1)
  if (end > 0 && lastCode >= 0xd800 && lastCode <= 0xdbff) end -= 1
  const truncated = text.slice(0, end)
  return truncated.length > 0 ? truncated : null
}

export type InboundUploadSkipReason = Extract<InboxEmailAttachmentReason, 'dangerous_executable' | 'active_content' | 'too_large'>
export type InboundUploadFailureReason = Extract<InboxEmailAttachmentReason, 'quota_exceeded' | 'partition_unavailable' | 'store_failed'>

export type InboundUploadErrorClassification =
  | { kind: 'skipped'; reason: InboundUploadSkipReason }
  | { kind: 'failed'; reason: InboundUploadFailureReason }
  | { kind: 'transient'; code: string }
  | { kind: 'aborted'; code: typeof INBOX_CLAIM_LOST_CODE }
  | { kind: 'already_stored' }

const CLASSIFIED_UPLOAD_ERRORS: Readonly<Record<string, Exclude<InboundUploadErrorClassification, { kind: 'transient' | 'aborted' | 'already_stored' }>>> = {
  dangerous_executable: { kind: 'skipped', reason: 'dangerous_executable' },
  active_content: { kind: 'skipped', reason: 'active_content' },
  max_upload_size: { kind: 'skipped', reason: 'too_large' },
  quota_exceeded: { kind: 'failed', reason: 'quota_exceeded' },
  partition_unavailable: { kind: 'failed', reason: 'partition_unavailable' },
  quota_target_exists: { kind: 'failed', reason: 'store_failed' },
  quota_recovery_unsupported: { kind: 'failed', reason: 'store_failed' },
}

const UNKNOWN_UPLOAD_ERROR_CODE = 'unknown'

function readErrorCode(error: unknown): string | null {
  if (!isCrudHttpError(error)) return null
  const code = error.body?.code
  return typeof code === 'string' && code.length > 0 ? code : null
}

/**
 * Maps a `createScoped` failure: policy codes become `skipped`, operator-visible errors
 * `failed`, and `quota_unavailable`, `storage_failed`, `persistence_failed`, unknown codes and
 * errors without a code (for example the 500 when the upload service is unavailable) transient.
 * The two `persistLink` conflicts abort the run (`inbox_claim_lost`) or count as stored.
 */
export function classifyInboundUploadError(error: unknown): InboundUploadErrorClassification {
  const code = readErrorCode(error)
  if (code === INBOX_CLAIM_LOST_CODE) return { kind: 'aborted', code: INBOX_CLAIM_LOST_CODE }
  if (code === INBOX_PART_ALREADY_STORED_CODE) return { kind: 'already_stored' }
  if (code && CLASSIFIED_UPLOAD_ERRORS[code]) return CLASSIFIED_UPLOAD_ERRORS[code]
  return { kind: 'transient', code: code ?? UNKNOWN_UPLOAD_ERROR_CODE }
}

export type InboundPartToPersist = {
  /** Ledger row id. */
  id: string
  status: InboxEmailAttachmentStatus
  /** Decrypted ledger name (original or fallback). */
  fileName: string | null
  declaredMimeType: string | null
  /** 1-based position, used for the fallback name when the ledger name is empty. */
  position?: number
}

export type PersistInboundPartInput = {
  attachmentService: Pick<AttachmentService, 'createScoped'>
  encryptionService: Pick<TenantDataEncryptionService, 'encryptEntityPayload'>
  email: { id: string; tenantId: string; organizationId: string }
  /** The worker's current claim on the email; every write is conditional on it. */
  claimToken: string
  part: InboundPartToPersist
  buffer: Buffer
  config: Pick<InboundAttachmentsConfig, 'maxFileBytes' | 'maxTextCharsPerFile'>
  /** `'none'` stores the file without text: the last attempt of a part whose processing crashed. */
  textExtraction?: 'return' | 'none'
  now?: () => Date
}

export type PersistInboundPartOutcome =
  | { kind: 'stored'; alreadyStored: false; attachmentId: string; mimeType: string; fileSize: number }
  | { kind: 'stored'; alreadyStored: true }
  | { kind: 'skipped'; reason: InboundUploadSkipReason }
  | { kind: 'failed'; reason: InboundUploadFailureReason }
  | { kind: 'transient'; code: string; error: unknown }
  | { kind: 'aborted'; code: typeof INBOX_CLAIM_LOST_CODE }

function readEncryptedText(payload: Record<string, unknown>): string | null {
  const value = payload.extractedText
  return typeof value === 'string' ? value : null
}

/**
 * Persists one downloaded part (spec "`persistInboundParts()`"; the worker calls it per part).
 * `createScoped` stores the file under the email in the private partition and, in the same
 * transaction, `persistLink` renews the claim and marks the ledger row `stored` with the
 * truncated, encrypted text. Either conflict rolls the Attachment row and its quota reservation
 * back. Never throws for upload failures; the caller records the outcome.
 */
export async function persistInboundPart(input: PersistInboundPartInput): Promise<PersistInboundPartOutcome> {
  const { attachmentService, encryptionService, email, claimToken, part, buffer, config } = input
  if (part.status === 'stored') return { kind: 'stored', alreadyStored: true }
  if (buffer.length > config.maxFileBytes) return { kind: 'skipped', reason: 'too_large' }

  const now = input.now ?? (() => new Date())
  const ledgerName = part.fileName && part.fileName.trim().length > 0
    ? part.fileName
    : fallbackInboundFileName(part.position ?? 1, part.declaredMimeType)

  const persistLink: AttachmentPersistLink = async (tx: EntityManager, attachmentId, extras) => {
    const text = truncateInboundAttachmentText(extras?.content ?? null, config.maxTextCharsPerFile)
    const encrypted = await encryptionService.encryptEntityPayload(
      E.inbox_ops.inbox_email_attachment,
      { extractedText: text },
      email.tenantId,
      email.organizationId,
    )
    const timestamp = now()
    const renewed = await tx.nativeUpdate(
      InboxEmail,
      {
        id: email.id,
        tenantId: email.tenantId,
        organizationId: email.organizationId,
        attachmentsClaimToken: claimToken,
        deletedAt: null,
      },
      { attachmentsClaimedAt: timestamp },
    )
    if (renewed === 0) throw new CrudHttpError(409, { error: '[internal] inbox claim lost', code: INBOX_CLAIM_LOST_CODE })
    const marked = await tx.nativeUpdate(
      InboxEmailAttachment,
      {
        id: part.id,
        inboxEmailId: email.id,
        tenantId: email.tenantId,
        organizationId: email.organizationId,
        status: { $ne: 'stored' },
      },
      {
        status: 'stored',
        reason: null,
        attachmentId,
        extractedText: readEncryptedText(encrypted),
        updatedAt: timestamp,
      },
    )
    if (marked === 0) {
      throw new CrudHttpError(409, { error: '[internal] inbox part already stored', code: INBOX_PART_ALREADY_STORED_CODE })
    }
  }

  try {
    const created = await attachmentService.createScoped({
      entityId: INBOUND_ATTACHMENT_OWNER_ENTITY_ID,
      recordId: email.id,
      tenantId: email.tenantId,
      organizationId: email.organizationId,
      partitionCode: INBOUND_ATTACHMENT_PARTITION_CODE,
      fileName: inboundUploadFileName(ledgerName, part.declaredMimeType),
      declaredMimeType: part.declaredMimeType,
      buffer,
      textExtraction: input.textExtraction ?? 'return',
      persistLink,
    })
    return {
      kind: 'stored',
      alreadyStored: false,
      attachmentId: created.id,
      mimeType: created.mimeType,
      fileSize: created.fileSize,
    }
  } catch (error) {
    const classification = classifyInboundUploadError(error)
    switch (classification.kind) {
      case 'already_stored':
        return { kind: 'stored', alreadyStored: true }
      case 'transient':
        return { kind: 'transient', code: classification.code, error }
      default:
        return classification
    }
  }
}
