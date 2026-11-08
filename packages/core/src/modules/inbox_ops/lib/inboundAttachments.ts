import type { EntityManager } from '@mikro-orm/postgresql'
import { createModuleQueue, type Queue } from '@open-mercato/queue'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import {
  listUnguardedAttachmentReaders,
  type AttachmentPersistLink,
  type AttachmentService,
} from '@open-mercato/core/modules/attachments'
import { E } from '#generated/entities.ids.generated'
import {
  InboxEmail,
  InboxEmailAttachment,
  type InboxEmailAttachmentDisposition,
  type InboxEmailAttachmentReason,
  type InboxEmailAttachmentStatus,
} from '../data/entities'
import type { InboundAttachmentIngestJob, ResendInboundAttachment } from '../data/validators'
import { readInboundAttachmentsConfig, type InboundAttachmentsConfig } from './inboundAttachmentsConfig'

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

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const logger = createLogger('inbox_ops').child({ component: 'inbound-attachments' })

export type InboundAttachmentErrorCode =
  | 'inbox_ops.attachment_fetch_failed'
  | 'inbox_ops.attachment_store_failed'
  | 'inbox_ops.attachment_ingest_timeout'
  | 'inbox_ops.attachment_requeue_failed'
  | 'inbox_ops.attachment_release_failed'
  | 'inbox_ops.attachment_schedule_failed'

/** Reports through the telemetry funnel; a telemetry fault degrades to a warning. Attributes carry ids and codes only. */
export function reportInboundAttachmentError(
  error: unknown,
  code: InboundAttachmentErrorCode,
  attributes: Record<string, string | number | boolean | undefined> = {},
): void {
  try {
    getTelemetryRuntime()?.reportError(error, { module: 'inbox_ops', code, attributes })
  } catch (reportFailure) {
    logger.warn('Failed to report an inbound attachment error', { code, err: reportFailure })
  }
}

// ---------------------------------------------------------------------------
// Ingestion gate (spec D19)
// ---------------------------------------------------------------------------

export type InboundAttachmentGateConfig = Pick<InboundAttachmentsConfig, 'enabled' | 'allowUnguardedReaders' | 'resendStubEnabled'>

export type InboundAttachmentGateOptions = {
  config?: InboundAttachmentGateConfig
  listReaders?: () => string[]
}

const warnedOnce = new Set<string>()

function warnOncePerProcess(key: string, message: string, data: Record<string, unknown>): void {
  if (warnedOnce.has(key)) return
  warnedOnce.add(key)
  logger.warn(message, data)
}

/** The D19 test opt-out: honored only when both test-only flags are set. */
export function isUnguardedReaderTestOptOutActive(config: Pick<InboundAttachmentGateConfig, 'allowUnguardedReaders' | 'resendStubEnabled'>): boolean {
  return config.allowUnguardedReaders === true && config.resendStubEnabled === true
}

/**
 * Enabled modules that read attachment rows without owner checks and therefore block storing
 * inbound files, or an empty list when the test opt-out applies (which logs a warning). The
 * first call in the process that meets blocking modules logs one warning naming them.
 */
export function unguardedAttachmentReadersBlockingIngest(options: InboundAttachmentGateOptions = {}): string[] {
  const readers = (options.listReaders ?? listUnguardedAttachmentReaders)()
  if (readers.length === 0) return []
  const config = options.config ?? readInboundAttachmentsConfig()
  const modules = [...readers].sort((left, right) => left.localeCompare(right))
  if (isUnguardedReaderTestOptOutActive(config)) {
    warnOncePerProcess(
      `opt-out:${modules.join(',')}`,
      'Inbound attachment ingestion runs while unguarded attachment readers are enabled (INBOX_OPS_ATTACHMENTS_ALLOW_UNGUARDED_READERS with OM_ENABLE_RESEND_STUB; test only)',
      { modules },
    )
    return []
  }
  warnOncePerProcess(
    `blocking:${modules.join(',')}`,
    'Inbound email attachments are not stored while modules that read attachments without owner checks are enabled',
    { modules },
  )
  return modules
}

/** `INBOX_OPS_ATTACHMENTS_ENABLED` is on (checked first) and no unguarded reader blocks ingestion. */
export function isInboundAttachmentIngestEnabled(options: InboundAttachmentGateOptions = {}): boolean {
  const config = options.config ?? readInboundAttachmentsConfig()
  if (!config.enabled) return false
  return unguardedAttachmentReadersBlockingIngest({ ...options, config }).length === 0
}

const STORED_ROWS_CHECK_TTL_MS = 5 * 60 * 1000
let storedRowsCheckedAt = 0

/**
 * While an unguarded reader is enabled and any `stored` ledger row exists, warns once per process
 * that those files are readable through it. Logged by the maintenance worker and by the first
 * webhook or worker run that meets the closed gate. Returns whether the condition holds.
 */
export async function warnIfStoredInboundAttachmentsReadableByUnguardedReaders(
  em: EntityManager,
  readers: readonly string[],
  now: () => Date = () => new Date(),
): Promise<boolean> {
  if (readers.length === 0) return false
  const modules = [...readers].sort((left, right) => left.localeCompare(right))
  const key = `stored:${modules.join(',')}`
  if (warnedOnce.has(key)) return true
  const timestamp = now().getTime()
  if (storedRowsCheckedAt > 0 && timestamp - storedRowsCheckedAt < STORED_ROWS_CHECK_TTL_MS) return false
  storedRowsCheckedAt = timestamp
  const rows = await em.getConnection().execute<Array<{ found: number }>>(
    `select 1 as found from inbox_email_attachments where status = 'stored' and deleted_at is null limit 1`,
  )
  if (!Array.isArray(rows) || rows.length === 0) return false
  warnOncePerProcess(
    key,
    'Stored inbound email attachments are readable through modules that read attachments without owner checks',
    { modules },
  )
  return true
}

/** Test helper: forgets the per-process warnings. */
export function resetInboundAttachmentGateWarningsForTests(): void {
  warnedOnce.clear()
  storedRowsCheckedAt = 0
}

// ---------------------------------------------------------------------------
// Ingest job queue and the re-enqueue helper (spec D10)
// ---------------------------------------------------------------------------

export const INBOX_OPS_ATTACHMENT_INGEST_QUEUE = 'inbox-ops-attachment-ingest'
export const INBOX_OPS_ATTACHMENT_INGEST_CONCURRENCY = 2
/** Attempts `createModuleQueue` gives a job by default; the worker re-enqueues itself on the last one. */
export const INBOX_OPS_ATTACHMENT_INGEST_QUEUE_ATTEMPTS = 3
/** Generation the webhook inserts a pending email with and enqueues its first job under. */
export const INITIAL_INBOUND_ATTACHMENT_INGEST_GENERATION = 1

export type InboundAttachmentIngestEnqueuer = Pick<Queue<InboundAttachmentIngestJob>, 'enqueue'>

let ingestQueue: Queue<InboundAttachmentIngestJob> | null = null

/**
 * The ingest queue. It sets no `coalesceBy` and no enqueue passes `coalesce`: a coalesced add
 * would drop a re-enqueue carrying a newer generation, and delayed work must not use a key.
 */
export function getInboundAttachmentIngestQueue(): Queue<InboundAttachmentIngestJob> {
  if (!ingestQueue) {
    ingestQueue = createModuleQueue<InboundAttachmentIngestJob>(INBOX_OPS_ATTACHMENT_INGEST_QUEUE, {
      concurrency: INBOX_OPS_ATTACHMENT_INGEST_CONCURRENCY,
      attempts: INBOX_OPS_ATTACHMENT_INGEST_QUEUE_ATTEMPTS,
    })
  }
  return ingestQueue
}

/** Enqueues `{ emailId, tenantId, organizationId, generation }` and nothing else, optionally delayed. */
export async function enqueueInboundAttachmentIngestJob(
  job: InboundAttachmentIngestJob,
  options: { delayMs?: number; queue?: InboundAttachmentIngestEnqueuer } = {},
): Promise<string> {
  const queue = options.queue ?? getInboundAttachmentIngestQueue()
  const payload: InboundAttachmentIngestJob = {
    emailId: job.emailId,
    tenantId: job.tenantId,
    organizationId: job.organizationId,
    generation: job.generation,
  }
  const delayMs = options.delayMs && options.delayMs > 0 ? Math.floor(options.delayMs) : 0
  return delayMs > 0 ? queue.enqueue(payload, { delayMs }) : queue.enqueue(payload)
}

export type InboundAttachmentEmailRef = { id: string; tenantId: string; organizationId: string }

export type ReenqueueInboundAttachmentIngestInput = {
  em: EntityManager
  email: InboundAttachmentEmailRef
  delayMs?: number
  /**
   * The generation of the job that re-enqueues (the worker's own re-enqueues and
   * `onJobAbandoned`): the reservation then also requires that this job is not superseded.
   */
  jobGeneration?: number
  queue?: InboundAttachmentIngestEnqueuer
  now?: () => Date
}

export type ReenqueueInboundAttachmentIngestResult =
  | { kind: 'enqueued'; generation: number; jobId: string; confirmed: boolean }
  | { kind: 'not_reserved' }
  | { kind: 'enqueue_failed'; generation: number; error: unknown }

/** Step 1: one conditional `UPDATE … RETURNING`, so concurrent callers get different generations. */
export const RESERVE_INBOUND_ATTACHMENT_GENERATION_SQL = `update inbox_emails
   set attachments_ingest_generation = coalesce(attachments_ingest_generation, 0) + 1
 where id = ? and tenant_id = ? and organization_id = ?
   and deleted_at is null
   and attachments_status in ('pending', 'processing')`

const RESERVE_NOT_SUPERSEDED_SQL = `
   and coalesce(attachments_current_generation, 0) <= ?`

const RESERVE_RETURNING_SQL = `
 returning attachments_ingest_generation as generation`

function readGeneration(rows: unknown): number | null {
  if (!Array.isArray(rows) || rows.length === 0) return null
  const value = Number((rows[0] as { generation?: unknown }).generation)
  return Number.isInteger(value) && value > 0 ? value : null
}

/**
 * The single re-enqueue path (duplicate branch, catch-up, `onJobAbandoned`, manual retry, sweep,
 * the worker's delayed job): reserve a generation, enqueue the job, and confirm it as current only
 * after the enqueue succeeded. A failed enqueue changes nothing, so the previous job stays current.
 * Writes leave `inbox_emails.updated_at` unchanged.
 */
export async function reenqueueInboundAttachmentIngest(
  input: ReenqueueInboundAttachmentIngestInput,
): Promise<ReenqueueInboundAttachmentIngestResult> {
  const { em, email } = input
  const now = input.now ?? (() => new Date())
  const notSuperseded = typeof input.jobGeneration === 'number'
  const sql = RESERVE_INBOUND_ATTACHMENT_GENERATION_SQL
    + (notSuperseded ? RESERVE_NOT_SUPERSEDED_SQL : '')
    + RESERVE_RETURNING_SQL
  const params: unknown[] = [email.id, email.tenantId, email.organizationId]
  if (notSuperseded) params.push(input.jobGeneration)
  const rows = await em.getConnection().execute<Array<{ generation: number }>>(sql, params)
  const generation = readGeneration(rows)
  if (generation === null) return { kind: 'not_reserved' }

  const delayMs = input.delayMs && input.delayMs > 0 ? Math.floor(input.delayMs) : 0
  let jobId: string
  try {
    jobId = await enqueueInboundAttachmentIngestJob(
      { emailId: email.id, tenantId: email.tenantId, organizationId: email.organizationId, generation },
      { delayMs, queue: input.queue },
    )
  } catch (error) {
    return { kind: 'enqueue_failed', generation, error }
  }

  // Step 3: only a lower generation is superseded, so a failed or late confirmation never undoes a newer one.
  let confirmed = false
  try {
    const updated = await em.nativeUpdate(
      InboxEmail,
      {
        id: email.id,
        tenantId: email.tenantId,
        organizationId: email.organizationId,
        $or: [{ attachmentsCurrentGeneration: null }, { attachmentsCurrentGeneration: { $lt: generation } }],
      },
      { attachmentsCurrentGeneration: generation, attachmentsNextRunAt: new Date(now().getTime() + delayMs) },
    )
    confirmed = updated > 0
  } catch (error) {
    logger.warn('Failed to confirm an inbound attachment ingest job; the claim serializes the jobs', {
      emailId: email.id,
      generation,
      err: error,
    })
  }
  return { kind: 'enqueued', generation, jobId, confirmed }
}
