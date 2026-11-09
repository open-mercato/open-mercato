import { evaluateAttachmentAccess, type AttachmentAccessContext } from './access-runner'
import { throwAttachmentAccessError } from './access-errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { sql } from 'kysely'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { Attachment, AttachmentPartition } from '../data/entities'
import { assertAttachmentScopeInvariant, checkAttachmentAccess } from './access'
import type { StorageDriverFactory } from './drivers'
import { buildAttachmentFileUrl } from './imageUrls'
import {
  isScopedAttachmentUploadError,
  type AttachmentPersistLink,
  type AttachmentTextExtractionMode,
  type ScopedAttachmentUploadErrorCode,
  type ScopedAttachmentUploadService,
} from './scoped-upload-service'
import { readAttachmentMetadata, type AttachmentAssignment } from './metadata'
import {
  listAttachmentStorageReferences,
  lockAttachmentStorageReferences,
  removeAttachmentRecord,
  resolveAttachmentStorageRelease,
} from './storageReferences'
import { clearAttachmentThumbnailCache } from './thumbnailCache'
import {
  buildAttachmentContentDisposition,
  canRenderInlineAttachment,
  hasDangerousExecutableExtension,
} from './security'
import {
  isMultipartRequestWithinUploadLimit,
  resolveAttachmentMaxBytes,
  resolveAttachmentMultipartMaxBytes,
} from './upload-limits'

const logger = createLogger('attachments').child({ component: 'attachment-service' })

type AttachmentErrorMessage = {
  key: string
  fallback: string
}

/**
 * The scoped upload service reports failures as machine codes. Each maps to the
 * translation key the public attachment route uses for the same condition, and
 * the key is resolved server-side before it reaches the response body — clients
 * render the `error` field verbatim, so handing them a raw key would surface
 * `attachments.errors.quotaExceeded` as the user-facing message.
 */
const SCOPED_UPLOAD_ERROR_MESSAGES: Record<ScopedAttachmentUploadErrorCode, AttachmentErrorMessage> = {
  dangerous_executable: {
    key: 'attachments.errors.dangerousExecutable',
    fallback: 'Executable file types are not allowed as attachments.',
  },
  max_upload_size: {
    key: 'attachments.errors.maxUploadSize',
    fallback: 'Attachment exceeds the maximum upload size.',
  },
  active_content: {
    key: 'attachments.errors.activeContentBlocked',
    fallback: 'Active content uploads are not allowed.',
  },
  partition_unavailable: {
    key: 'attachments.errors.partitionUnavailable',
    fallback: 'Attachment partition is not available for this scope.',
  },
  quota_exceeded: {
    key: 'attachments.errors.quotaExceeded',
    fallback: 'Attachment storage quota exceeded for this tenant.',
  },
  quota_target_exists: {
    key: 'attachments.errors.storagePathExists',
    fallback: 'The target storage path already exists.',
  },
  quota_unavailable: {
    key: 'attachments.errors.quotaUnavailable',
    fallback: 'Storage quota accounting is unavailable.',
  },
  quota_recovery_unsupported: {
    key: 'attachments.errors.quotaRecoveryUnsupported',
    fallback: 'Storage driver cannot participate in quota recovery.',
  },
  storage_failed: {
    key: 'attachments.errors.storageFailed',
    fallback: 'Failed to store the attachment file.',
  },
  persistence_failed: {
    key: 'attachments.errors.persistenceFailed',
    fallback: 'Failed to persist attachment.',
  },
}

const UPLOAD_FAILED_MESSAGE: AttachmentErrorMessage = {
  key: 'attachments.errors.uploadFailed',
  fallback: 'Attachment upload failed.',
}

const UPLOAD_SERVICE_UNAVAILABLE_MESSAGE: AttachmentErrorMessage = {
  key: 'attachments.errors.uploadServiceUnavailable',
  fallback: 'The attachment upload service is not available.',
}

async function translateAttachmentError(message: AttachmentErrorMessage): Promise<string> {
  const { t } = await resolveTranslations()
  return t(message.key, message.fallback)
}

export type AttachmentOwner = {
  entityId: string
  recordId: string
}

export type CreateScopedAttachmentInput = AttachmentOwner & {
  tenantId: string
  organizationId: string
  partitionCode: string
  fileName: string
  declaredMimeType?: string | null
  buffer: Buffer
  assignments?: AttachmentAssignment[]
  /**
   * Persists a module-owned link inside the same transaction as the Attachment
   * row. The callback receives only the generated id, never an Attachment
   * entity or storage implementation. With `textExtraction: 'return'` it also
   * receives the extracted text as its third argument (`{ content }`).
   */
  persistLink?: AttachmentPersistLink
  /**
   * `'partition'` (default) keeps today's behavior: text is extracted only when
   * the partition has `requiresOcr`, stored in `Attachment.content`, and LLM OCR
   * is queued when available. `'return'` runs the pure-JS extractor whatever the
   * partition flag, never queues LLM OCR, leaves `Attachment.content` empty, and
   * hands the text to `persistLink` and to the result's `content`. `'none'`
   * extracts nothing and never queues OCR.
   *
   * In `'return'` mode a `null` text is ambiguous: the file has no extractable
   * text, or the extractor failed (logged, never thrown, so the upload still
   * succeeds). Callers that need to tell them apart must not rely on `content`.
   */
  textExtraction?: AttachmentTextExtractionMode
}

export type CreatedScopedAttachment = {
  id: string
  url: string
  fileName: string
  mimeType: string
  fileSize: number
  /**
   * Set only with `textExtraction: 'return'`: the extracted text, or `null` when there is none or
   * extraction failed (the two are not distinguished; see `textExtraction`).
   */
  content?: string | null
}

export type ReadScopedAttachmentInput = {
  attachmentId: string
  auth: NonNullable<AuthContext>
  expectedOwner: AttachmentOwner
  expectedAssignment?: AttachmentAssignment
  expectedPartitionCode?: string
  requirePrivatePartition?: boolean
  forceDownload?: boolean
}

export type ReadScopedAttachmentResult = {
  buffer: Buffer
  contentType: string
  contentDisposition: string
  fileName: string
  mimeType: string
}

export type ReleaseScopedAttachmentInput = {
  attachmentId: string
  tenantId: string
  organizationId: string
  expectedOwner: AttachmentOwner
  /**
   * Required: releasing an attachment deletes the row *and* the provider bytes,
   * so the caller must name the one assignment it owns. The release only
   * proceeds when that assignment is the attachment's sole reference.
   */
  expectedAssignment: AttachmentAssignment
  expectedPartitionCode?: string
}

export type AttachmentProviderCleanup = () => Promise<void>

export type ReleaseOwnedScopedAttachmentsInput = {
  /** The owner whose references are removed, as primary owner or as an assignment. */
  owner: AttachmentOwner
  tenantId: string
  organizationId: string
}

export type ReleaseOwnedScopedAttachmentsResult = {
  /** Rows deleted because the owner was their primary owner and their only reference. */
  deleted: number
  /** Rows owned by `owner` re-pointed to their first remaining assignment. */
  repointed: number
  /** Rows owned by something else that only lost `owner`'s assignment. */
  detached: number
}

export interface AttachmentService {
  validateUpload(input: {
    contentLength?: string | null
    fileName?: string
    fileSize?: number
  }): void
  readUploadForm?(request: Request): Promise<FormData>
  createScoped(input: CreateScopedAttachmentInput): Promise<CreatedScopedAttachment>
  readScoped(input: ReadScopedAttachmentInput): Promise<ReadScopedAttachmentResult>
  /**
   * Permanently deletes an attachment row and its stored object once no other row references it.
   *
   * With `{ flush: false }` call it inside your own transaction and run the returned cleanup after
   * commit; `undefined` means another row still references the stored object.
   *
   * Without `flush: false` the provider deletion runs after the row's own commit, and a failure of
   * it is thrown although the row is already gone.
   *
   * @deprecated Calling it with `{ flush: false }` outside a transaction. It still works for one
   * minor version but logs a warning, and its reference check is not locked, so two racing releases
   * of rows sharing the stored object keep it. Wrap the call in a transaction instead.
   */
  releaseScoped?(
    input: ReleaseScopedAttachmentInput,
    options?: { em?: EntityManager; flush?: boolean },
  ): Promise<AttachmentProviderCleanup | void>
  /**
   * Removes `owner`'s reference from every attachment row of the scope that carries it:
   * - a row whose primary owner is `owner` and that has no other assignment is deleted (its
   *   stored object only once no other row references it);
   * - a row whose primary owner is `owner` but that has other assignments is re-pointed to the
   *   first remaining assignment in stored order and loses `owner`'s assignment;
   * - a row whose primary owner is something else only loses `owner`'s assignment.
   *
   * Commits its own transaction, then deletes provider bytes; it refuses an entity manager that
   * is already inside a transaction. A retry after success finds nothing and returns zeros.
   *
   * Provider byte cleanup is best-effort: it runs after the commit, every deletion is attempted,
   * and a failure is logged and reported (`attachments.release_cleanup_failed`) instead of thrown,
   * because the rows are already gone and a retry could not find the bytes again. The result
   * therefore always describes the committed changes. (`releaseScoped` without `flush: false`
   * still throws such a failure after its commit.) Rows are locked together with every row sharing
   * their stored objects, in id order, so a concurrent single-object `releaseScoped` (which locks one
   * object's references in the same order) cannot deadlock with it. Other writers that lock these
   * rows in another order can still abort the transaction with a deadlock (40P01) or a
   * serialization failure; it then throws with nothing committed, and the caller must report it
   * and retry later (inbox_ops leaves the email to its maintenance sweep).
   *
   * All of the owner's rows are handled in this one transaction (one statement locks them, then
   * one storage-reference read per deleted row), so it is meant for owners with a bounded number
   * of rows, such as an inbound email (at most its ledger's parts); an owner with an unbounded
   * number of rows needs a batched release instead.
   */
  releaseOwnedScoped?(input: ReleaseOwnedScopedAttachmentsInput): Promise<ReleaseOwnedScopedAttachmentsResult>
}

async function readRequestBodyWithinLimit(request: Request, maxBytes: number): Promise<Uint8Array> {
  const reader = request.body?.getReader()
  if (!reader) throw new CrudHttpError(400, { error: 'File is required' })
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel()
        throw new CrudHttpError(413, { error: 'Attachment exceeds the maximum upload size.' })
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}


function assignmentMatches(candidate: AttachmentAssignment, expected: AttachmentAssignment): boolean {
  return candidate.type === expected.type && candidate.id === expected.id
}

async function clearAttachmentThumbnailCacheSafely(attachment: Pick<Attachment, 'id' | 'partitionCode'>): Promise<void> {
  await clearAttachmentThumbnailCache(attachment.partitionCode, attachment.id).catch((error) => {
    logger.error('Failed to clean up cached thumbnails', { attachmentId: attachment.id, err: error })
  })
}

/**
 * Locks, in one id-ordered statement, every row of the scope that references `owner` (as primary
 * owner, served by `attachments_entity_record_idx`, or as an assignment, found by jsonb containment
 * so `attachments_storage_metadata_gin_idx` serves it; both stored shapes of `assignments` are
 * probed: the array written today and the single legacy object) together with every row, of any
 * scope, that shares a stored object with one of them (`attachments_storage_reference_idx`).
 *
 * Taking the storage siblings in the same ordered lock keeps the lock order of `releaseScoped`
 * (which locks one object's references in id order): locking owner rows first and each row's
 * siblings later could deadlock against a concurrent release of a sibling.
 */
async function lockOwnedAttachmentRows(
  em: EntityManager,
  owner: AttachmentOwner,
  scope: { tenantId: string; organizationId: string },
): Promise<string[]> {
  const assignment = { type: owner.entityId, id: owner.recordId }
  const result = await sql<{ id: string }>`with "owned" as (
  select "id", "partition_code", "storage_path" from "attachments"
   where "tenant_id" = ${scope.tenantId} and "organization_id" = ${scope.organizationId}
     and (("entity_id" = ${owner.entityId} and "record_id" = ${owner.recordId})
       or "storage_metadata" @> ${JSON.stringify({ assignments: [assignment] })}::jsonb
       or "storage_metadata" @> ${JSON.stringify({ assignments: assignment })}::jsonb)
)
select "attachments"."id" from "attachments"
 where "attachments"."id" in (
   select "id" from "owned"
   union
   select "sibling"."id" from "attachments" as "sibling"
     join "owned" on "sibling"."partition_code" = "owned"."partition_code" and "sibling"."storage_path" = "owned"."storage_path"
 )
 order by "attachments"."id"
 for update of "attachments"`.execute(em.getKysely())
  return result.rows.map((row) => String(row.id))
}

/**
 * The distinct partitions of the owner's rows, read without locking before the release transaction,
 * so the storage drivers can be resolved before any row lock is held. Advisory only: the locked
 * read inside the transaction stays authoritative, and a partition that shows up only there is
 * resolved there.
 */
async function listOwnedAttachmentPartitionCodes(
  em: EntityManager,
  owner: AttachmentOwner,
  scope: { tenantId: string; organizationId: string },
): Promise<string[]> {
  const assignment = { type: owner.entityId, id: owner.recordId }
  const result = await sql<{ partition_code: string }>`select distinct "partition_code" from "attachments"
 where "tenant_id" = ${scope.tenantId} and "organization_id" = ${scope.organizationId}
   and (("entity_id" = ${owner.entityId} and "record_id" = ${owner.recordId})
     or "storage_metadata" @> ${JSON.stringify({ assignments: [assignment] })}::jsonb
     or "storage_metadata" @> ${JSON.stringify({ assignments: assignment })}::jsonb)`.execute(em.getKysely())
  return result.rows.map((row) => String(row.partition_code))
}

function partitionMatchesScope(
  partition: AttachmentPartition,
  tenantId: string | null | undefined,
  organizationId: string | null | undefined,
): boolean {
  const partitionTenantId = partition.tenantId ?? null
  const partitionOrganizationId = partition.organizationId ?? null
  if (partitionTenantId === null && partitionOrganizationId === null) return true
  if (partitionTenantId === null || partitionOrganizationId === null) return false
  return partitionTenantId === tenantId && partitionOrganizationId === organizationId
}

export class DefaultAttachmentService implements AttachmentService {
  /**
   * The scoped upload service is supplied as a *resolver*, not an instance:
   * resolving it eagerly would drag its own dependencies (notably `dataEngine`)
   * into every container that merely constructs an `attachmentService`, even
   * one that never uploads. `createScoped` requires it — module uploads must
   * share the one reservation ledger rather than run a parallel quota
   * mechanism — so its absence surfaces there, at the call that needs it.
   */
  constructor(
    private readonly em: EntityManager,
    private readonly storageDriverFactory: StorageDriverFactory,
    private readonly resolveScopedUploadService?: (() => ScopedAttachmentUploadService | null) | null,
    private readonly resolveAccessContext?: (() => AttachmentAccessContext) | null,
  ) {}

  validateUpload(input: {
    contentLength?: string | null
    fileName?: string
    fileSize?: number
  }): void {
    if (!isMultipartRequestWithinUploadLimit(input.contentLength ?? null)) {
      throw new CrudHttpError(413, { error: 'Attachment exceeds the maximum upload size.', code: 'max_upload_size' })
    }
    if (input.fileName && hasDangerousExecutableExtension(input.fileName)) {
      throw new CrudHttpError(400, { error: 'Executable file types are not allowed as attachments.', code: 'dangerous_executable' })
    }
    if (typeof input.fileSize === 'number' && input.fileSize > resolveAttachmentMaxBytes(null)) {
      throw new CrudHttpError(413, { error: 'Attachment exceeds the maximum upload size.', code: 'max_upload_size' })
    }
  }

  async readUploadForm(request: Request): Promise<FormData> {
    this.validateUpload({ contentLength: request.headers.get('content-length') })
    const contentType = request.headers.get('content-type') ?? ''
    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      throw new CrudHttpError(400, { error: 'Expected multipart/form-data' })
    }
    const body = await readRequestBodyWithinLimit(request, resolveAttachmentMultipartMaxBytes())
    const responseBody = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer
    try {
      return await new Response(responseBody, { headers: { 'content-type': contentType } }).formData()
    } catch {
      throw new CrudHttpError(400, { error: 'Invalid multipart/form-data' })
    }
  }

  async createScoped(input: CreateScopedAttachmentInput): Promise<CreatedScopedAttachment> {
    assertAttachmentScopeInvariant(input)
    this.validateUpload({ fileName: input.fileName, fileSize: input.buffer.length })

    // Delegate to the platform's scoped upload service rather than repeating its
    // work. It owns the fenced quota lease (reserve → storing → stored →
    // complete) that the recovery worker reconciles, writes to the provider
    // outside the database transaction, and emits the attachment CRUD side
    // effects. The previous implementation here ran a *second*, independent
    // quota mechanism on a different advisory-lock key that counted only
    // committed rows, so it could not see an in-flight reservation from the
    // public attachment route and the two paths could jointly exceed a tenant's
    // quota — and it wrote to storage inside the transaction, so a crash before
    // commit left bytes nothing accounted for.
    let uploadService: ScopedAttachmentUploadService | null = null
    try {
      uploadService = this.resolveScopedUploadService?.() ?? null
    } catch (error) {
      logger.error('Scoped attachment upload service could not be resolved', { err: error })
    }
    if (!uploadService) {
      throw new CrudHttpError(500, {
        error: await translateAttachmentError(UPLOAD_SERVICE_UNAVAILABLE_MESSAGE),
      })
    }

    // Passed through as given: the upload service applies the `'partition'` default and rejects an
    // unknown mode (a `null` from an untyped caller included) instead of this layer coercing it.
    const textExtraction = input.textExtraction
    let returnedContent: string | null = null
    // In 'return' mode the text reaches the caller only through `persistLink`'s third argument;
    // wrapping the callback captures it for the result even when the caller passed none.
    const persistLink: AttachmentPersistLink | undefined = textExtraction === 'return'
      ? async (tx, attachmentId, extras) => {
          returnedContent = extras?.content ?? null
          await input.persistLink?.(tx, attachmentId, extras)
        }
      : input.persistLink
    let attachment: Attachment
    try {
      attachment = await uploadService.upload({
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        entityId: input.entityId,
        recordId: input.recordId,
        fileName: input.fileName,
        buffer: input.buffer,
        declaredMimeType: input.declaredMimeType ?? null,
        assignments: input.assignments,
        partitionCode: input.partitionCode,
        requirePrivatePartition: true,
        persistLink,
        textExtraction,
      })
    } catch (error) {
      if (isScopedAttachmentUploadError(error)) {
        const message = SCOPED_UPLOAD_ERROR_MESSAGES[error.code] ?? UPLOAD_FAILED_MESSAGE
        throw new CrudHttpError(error.status, { error: await translateAttachmentError(message), code: error.code })
      }
      throw error
    }

    const created: CreatedScopedAttachment = {
      id: attachment.id,
      url: attachment.url ?? buildAttachmentFileUrl(attachment.id),
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      fileSize: attachment.fileSize,
    }
    if (textExtraction === 'return') created.content = returnedContent
    return created
  }

  async readScoped(input: ReadScopedAttachmentInput): Promise<ReadScopedAttachmentResult> {
    // Scope the lookup at the database boundary so a foreign-tenant row is
    // never materialized, then keep checkAttachmentAccess below as defense in
    // depth. This service only ever stores fully scoped rows, so global rows
    // and super-admin status deliberately do not widen the requested scope —
    // a super admin reads another tenant's attachment by switching scope, not
    // by bypassing the filter.
    const attachment = await findOneWithDecryption(
      this.em,
      Attachment,
      {
        id: input.attachmentId,
        tenantId: input.auth.tenantId ?? null,
        organizationId: input.auth.orgId ?? null,
      },
      undefined,
      { tenantId: input.auth.tenantId, organizationId: input.auth.orgId },
    )
    if (!attachment) throw new CrudHttpError(404, { error: 'Attachment not found' })
    const partition = await findOneWithDecryption(
      this.em,
      AttachmentPartition,
      { code: attachment.partitionCode },
      undefined,
      { tenantId: input.auth.tenantId, organizationId: input.auth.orgId },
    )
    if (!partition) throw new CrudHttpError(500, { error: 'Attachment partition is not configured' })

    const access = await evaluateAttachmentAccess({
      auth: input.auth, attachment, partition, action: 'read',
      context: this.resolveAccessContext?.(), requireAuthForPublic: true,
    })
    if (!access.ok) await throwAttachmentAccessError(access.status)
    if (!partitionMatchesScope(partition, input.auth.tenantId, input.auth.orgId)) {
      throw new CrudHttpError(403, { error: 'Attachment partition is not accessible for this scope' })
    }
    if (input.requirePrivatePartition && partition.isPublic) {
      throw new CrudHttpError(403, { error: 'Attachment partition is not accessible for this resource' })
    }
    if (input.expectedPartitionCode && attachment.partitionCode !== input.expectedPartitionCode) {
      throw new CrudHttpError(404, { error: 'Attachment not found' })
    }
    if (
      attachment.entityId !== input.expectedOwner.entityId ||
      attachment.recordId !== input.expectedOwner.recordId
    ) {
      throw new CrudHttpError(404, { error: 'Attachment not found' })
    }
    if (input.expectedAssignment) {
      const assignments = readAttachmentMetadata(attachment.storageMetadata).assignments ?? []
      if (!assignments.some((candidate) => assignmentMatches(candidate, input.expectedAssignment!))) {
        throw new CrudHttpError(404, { error: 'Attachment not found' })
      }
    }

    const driver = await this.storageDriverFactory.resolveForPartition(attachment.partitionCode, {
      tenantId: attachment.tenantId ?? '',
      organizationId: attachment.organizationId ?? '',
    })
    let result: Awaited<ReturnType<typeof driver.read>>
    try {
      result = await driver.read(attachment.partitionCode, attachment.storagePath)
    } catch {
      throw new CrudHttpError(404, { error: 'File not available' })
    }

    const mimeType = attachment.mimeType || 'application/octet-stream'
    const renderInline = !input.forceDownload && canRenderInlineAttachment(mimeType)
    return {
      buffer: result.buffer,
      contentType: renderInline ? result.contentType ?? mimeType : 'application/octet-stream',
      contentDisposition: buildAttachmentContentDisposition(
        attachment.fileName,
        renderInline ? 'inline' : 'attachment',
      ),
      fileName: attachment.fileName,
      mimeType,
    }
  }

  async releaseScoped(
    input: ReleaseScopedAttachmentInput,
    options: { em?: EntityManager; flush?: boolean } = {},
  ): Promise<AttachmentProviderCleanup | void> {
    const em = options.em ?? this.em
    // The type makes `expectedAssignment` mandatory, but this service is handed
    // out through untyped DI resolution and consumed through structural ports in
    // other packages, so the shared-reference guard is enforced at runtime too:
    // without it a caller could destroy an attachment other records still link.
    const expectedAssignment = input.expectedAssignment
    if (!expectedAssignment) {
      throw new CrudHttpError(500, {
        error: 'Attachment release requires the expected assignment of the releasing record',
      })
    }
    const isInTransaction = (em as { isInTransaction?: () => boolean }).isInTransaction
    if (
      options.flush !== false
      && typeof isInTransaction === 'function'
      && isInTransaction.call(em)
    ) {
      throw new CrudHttpError(500, {
        error: 'Attachment release inside an ambient transaction requires flush: false and deferred provider cleanup',
      })
    }
    const deferredOutsideTransaction = options.flush === false
      && typeof isInTransaction === 'function'
      && !isInTransaction.call(em)
    if (deferredOutsideTransaction) {
      logger.warn(
        '[deprecated] attachmentService.releaseScoped({ flush: false }) called outside a transaction; wrap it in a transaction so the storage reference lock is held until commit',
        { attachmentId: input.attachmentId },
      )
    }
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const attachment = await findOneWithDecryption(
      em,
      Attachment,
      {
        id: input.attachmentId,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      },
      undefined,
      scope,
    )
    if (!attachment) throw new CrudHttpError(404, { error: 'Attachment not found' })
    if (
      attachment.entityId !== input.expectedOwner.entityId
      || attachment.recordId !== input.expectedOwner.recordId
      || (input.expectedPartitionCode && attachment.partitionCode !== input.expectedPartitionCode)
    ) {
      throw new CrudHttpError(404, { error: 'Attachment not found' })
    }
    const assignments = readAttachmentMetadata(attachment.storageMetadata).assignments ?? []
    if (!assignments.some((candidate) => assignmentMatches(candidate, expectedAssignment))) {
      throw new CrudHttpError(409, { error: 'Attachment is still referenced by another record' })
    }
    if (assignments.some((candidate) => !assignmentMatches(candidate, expectedAssignment))) {
      throw new CrudHttpError(409, { error: 'Attachment is still referenced by another record' })
    }

    const driver = await this.storageDriverFactory.resolveForPartition(attachment.partitionCode, scope)
    const deleteProviderBytes = () => driver.delete(attachment.partitionCode, attachment.storagePath)
    if (options.flush === false) {
      const referenceIds = deferredOutsideTransaction
        ? await listAttachmentStorageReferences(em, attachment)
        : await lockAttachmentStorageReferences(em, attachment)
      const removal = resolveAttachmentStorageRelease(referenceIds, attachment.id)
      if (!removal.removed) throw new CrudHttpError(404, { error: 'Attachment not found' })
      em.remove(attachment)
      // The cache is derived data keyed by this row only; a rollback merely regenerates it.
      await clearAttachmentThumbnailCacheSafely(attachment)
      return removal.releaseStorage ? deleteProviderBytes : undefined
    }
    const removal = await removeAttachmentRecord(em, attachment)
    if (!removal.removed) throw new CrudHttpError(404, { error: 'Attachment not found' })
    await clearAttachmentThumbnailCacheSafely(attachment)
    if (removal.releaseStorage) await deleteProviderBytes()
  }

  async releaseOwnedScoped(input: ReleaseOwnedScopedAttachmentsInput): Promise<ReleaseOwnedScopedAttachmentsResult> {
    const ownerEntityId = typeof input.owner?.entityId === 'string' ? input.owner.entityId.trim() : ''
    const ownerRecordId = typeof input.owner?.recordId === 'string' ? input.owner.recordId.trim() : ''
    if (!ownerEntityId || !ownerRecordId || !input.tenantId || !input.organizationId) {
      throw new CrudHttpError(500, { error: 'Owned attachment release requires an owner and a tenant and organization scope' })
    }
    const isInTransaction = (this.em as { isInTransaction?: () => boolean }).isInTransaction
    if (typeof isInTransaction === 'function' && isInTransaction.call(this.em)) {
      throw new CrudHttpError(500, {
        error: 'Owned attachment release commits its own transaction before provider cleanup; call it outside a transaction',
      })
    }
    const owner = { entityId: ownerEntityId, recordId: ownerRecordId }
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const result: ReleaseOwnedScopedAttachmentsResult = { deleted: 0, repointed: 0, detached: 0 }
    const removedRows: Attachment[] = []
    const providerCleanups: Array<{ attachmentId: string; run: AttachmentProviderCleanup }> = []

    // One driver per partition for this call; an owner's rows usually share one partition. Drivers
    // are resolved before the transaction (from a non-locking read of the owner's partitions), so
    // resolution I/O does not run while the owner's rows and their storage siblings are locked; only
    // a partition first seen under the lock is resolved inside it. A partition whose resolution
    // fails here is retried lazily inside, so it fails the release only if a removed row needs it.
    const drivers = new Map<string, ReturnType<StorageDriverFactory['resolveForPartition']>>()
    const resolveDriver = (partitionCode: string) => {
      let driver = drivers.get(partitionCode)
      if (!driver) {
        driver = this.storageDriverFactory.resolveForPartition(partitionCode, scope)
        drivers.set(partitionCode, driver)
      }
      return driver
    }
    for (const partitionCode of await listOwnedAttachmentPartitionCodes(this.em, owner, scope)) {
      try {
        await resolveDriver(partitionCode)
      } catch {
        drivers.delete(partitionCode)
      }
    }
    await this.em.transactional(async (tx) => {
      const candidateIds = await lockOwnedAttachmentRows(tx, owner, scope)
      if (!candidateIds.length) return
      const rows = await findWithDecryption(
        tx,
        Attachment,
        { id: { $in: candidateIds }, tenantId: scope.tenantId, organizationId: scope.organizationId },
        { orderBy: { id: 'asc' }, refresh: true },
        scope,
      )
      // Rows removed earlier in this transaction still answer the storage-reference lock until
      // the flush, so they are discounted here; otherwise two rows sharing one stored object,
      // both released now, would each see the other and keep the bytes forever.
      const removedIds = new Set<string>()
      for (const row of rows) {
        const metadata = readAttachmentMetadata(row.storageMetadata)
        const assignments = metadata.assignments ?? []
        const remaining = assignments.filter((assignment) => (
          assignment.type !== owner.entityId || assignment.id !== owner.recordId
        ))
        const isPrimary = row.entityId === owner.entityId && row.recordId === owner.recordId
        if (isPrimary && !remaining.length) {
          // Re-read the row's storage references instead of trusting the locked set: a copy that
          // committed after the combined lock (it inserts a new row and locks nothing of ours)
          // shares the object, and only a fresh read sees it, so its bytes are kept. The read does
          // not lock: taking a late sibling's lock here, after the id-ordered statement, could
          // deadlock against a release of that sibling. Not locking it is safe, because every
          // other release locks all references of the object, this row among them, and so waits
          // for this commit and then sees this row gone (READ COMMITTED). One read per removed row;
          // `releaseOwnedScoped` is meant for owners with a bounded number of rows.
          const referenceIds = (await listAttachmentStorageReferences(tx, row)).filter((id) => !removedIds.has(id))
          const removal = resolveAttachmentStorageRelease(referenceIds, row.id)
          if (!removal.removed) continue
          if (removal.releaseStorage) {
            const driver = await resolveDriver(row.partitionCode)
            const partitionCode = row.partitionCode
            const storagePath = row.storagePath
            providerCleanups.push({ attachmentId: row.id, run: () => driver.delete(partitionCode, storagePath) })
          }
          removedIds.add(row.id)
          removedRows.push(row)
          tx.remove(row)
          result.deleted += 1
          continue
        }
        if (remaining.length === assignments.length && !isPrimary) continue
        row.storageMetadata = { ...metadata, assignments: remaining }
        if (isPrimary) {
          row.entityId = remaining[0].type
          row.recordId = remaining[0].id
          result.repointed += 1
        } else {
          result.detached += 1
        }
      }
      await tx.flush()
    })

    for (const row of removedRows) await clearAttachmentThumbnailCacheSafely(row)
    // Best-effort: the rows are committed as removed, so a failure must not misreport the release.
    for (const cleanup of providerCleanups) {
      try {
        await cleanup.run()
      } catch (error) {
        logger.error('Owned attachment provider cleanup failed', { attachmentId: cleanup.attachmentId, err: error })
        try {
          getTelemetryRuntime()?.reportError(error, {
            module: 'attachments',
            code: 'attachments.release_cleanup_failed',
            attributes: { attachmentId: cleanup.attachmentId },
          })
        } catch (reportFailure) {
          logger.warn('Failed to report an attachment cleanup failure', { err: reportFailure })
        }
      }
    }
    return result
  }
}
