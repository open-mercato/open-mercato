import { attachmentPartitionVisibility, indexAttachmentPartitions, resolveAttachmentPartition } from './partitionScope'
import { evaluateAttachmentAccess, type AttachmentAccessContext } from './access-runner'
import { throwAttachmentAccessError } from './access-errors'
import { ensureAttachmentPartitionProtection } from './access-protection'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { Attachment, AttachmentPartition } from '../data/entities'
import { assertAttachmentScopeInvariant, checkAttachmentAccess } from './access'
import type { StorageDriverFactory } from './drivers'
import { buildAttachmentFileUrl } from './imageUrls'
import {
  isScopedAttachmentUploadError,
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
import { enqueuePurgedSectionSearchDelete, purgeDocumentStructure } from './documentStructure/purge'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { attachmentCrudEvents, attachmentCrudIndexer } from './crud'
import { clearAttachmentThumbnailCache } from './thumbnailCache'

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
   * entity or storage implementation.
   */
  persistLink?: (tx: EntityManager, attachmentId: string) => Promise<void> | void
}

export type CreatedScopedAttachment = {
  id: string
  url: string
  fileName: string
  mimeType: string
  fileSize: number
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

export type DescribeScopedAttachmentInput = Omit<ReadScopedAttachmentInput, 'forceDownload'>

export type DescribedScopedAttachment = {
  id: string
  fileName: string
  mimeType: string
  fileSize: number
  partitionCode: string
}

export type DescribeManyScopedAttachmentsInput = {
  auth: NonNullable<AuthContext>
  items: Array<Omit<DescribeScopedAttachmentInput, 'auth'>>
}

type ListScopedOwnerAttachmentIdsInput = {
  auth: NonNullable<AuthContext>
  expectedOwner: AttachmentOwner
  limit: number
}

type ReassignScopedAttachmentsInput = {
  auth: NonNullable<AuthContext>
  attachmentIds: string[]
  expectedOwner: AttachmentOwner
  destination: AttachmentOwner
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
   * Runs every check `readScoped` runs and returns the attachment's metadata
   * without reading its bytes, so a caller can validate a file before it is
   * read later (for example at delivery time).
   */
  describeScoped?(input: DescribeScopedAttachmentInput): Promise<DescribedScopedAttachment>
  /**
   * `describeScoped` for several attachments of one actor: the rows and their
   * partitions load in one query each, then every item gets the same checks,
   * in order. Resolves to one result per item, in input order; throws the
   * first item's refusal, as a loop over `describeScoped` would.
   */
  describeManyScoped?(input: DescribeManyScopedAttachmentsInput): Promise<DescribedScopedAttachment[]>
  listScopedOwnerAttachmentIds?(input: ListScopedOwnerAttachmentIdsInput): Promise<string[]>
  reassignScopedAttachments?(input: ReassignScopedAttachmentsInput, em: EntityManager): Promise<boolean>
  /**
   * Permanently deletes an attachment row and its stored object once no other row references it,
   * then emits `attachments.attachment.deleted` (with its query-index side effect) after commit.
   *
   * With `{ flush: false }` call it inside your own transaction and run the returned cleanup after
   * commit; it deletes the stored object when no other row references it, queues removal of the
   * purged sections' search records, clears cached thumbnails and emits the delete event. Always
   * invoke a returned cleanup; `undefined` means there is nothing left to clean up.
   *
   * @deprecated Calling it with `{ flush: false }` outside a transaction. It still works for one
   * minor version but logs a warning, and its reference check is not locked, so two racing releases
   * of rows sharing the stored object keep it. Wrap the call in a transaction instead.
   */
  releaseScoped?(
    input: ReleaseScopedAttachmentInput,
    options?: { em?: EntityManager; flush?: boolean },
  ): Promise<AttachmentProviderCleanup | void>
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


function toDescribedScopedAttachment(attachment: Attachment): DescribedScopedAttachment {
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType || 'application/octet-stream',
    fileSize: attachment.fileSize,
    partitionCode: attachment.partitionCode,
  }
}

function assignmentMatches(candidate: AttachmentAssignment, expected: AttachmentAssignment): boolean {
  return candidate.type === expected.type && candidate.id === expected.id
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
    private readonly resolveDataEngine?: (() => DataEngine | null) | null,
  ) {}

  private async emitReleasedSideEffects(attachment: Attachment): Promise<void> {
    await clearAttachmentThumbnailCache(attachment.partitionCode, attachment.id)
    const dataEngine = this.resolveDataEngine?.() ?? null
    if (!dataEngine) return
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: attachment,
      identifiers: {
        id: attachment.id,
        organizationId: attachment.organizationId ?? null,
        tenantId: attachment.tenantId ?? null,
      },
      events: attachmentCrudEvents,
      indexer: attachmentCrudIndexer,
    })
    await dataEngine.flushOrmEntityChanges()
  }

  validateUpload(input: {
    contentLength?: string | null
    fileName?: string
    fileSize?: number
  }): void {
    if (!isMultipartRequestWithinUploadLimit(input.contentLength ?? null)) {
      throw new CrudHttpError(413, { error: 'Attachment exceeds the maximum upload size.' })
    }
    if (input.fileName && hasDangerousExecutableExtension(input.fileName)) {
      throw new CrudHttpError(400, { error: 'Executable file types are not allowed as attachments.' })
    }
    if (typeof input.fileSize === 'number' && input.fileSize > resolveAttachmentMaxBytes(null)) {
      throw new CrudHttpError(413, { error: 'Attachment exceeds the maximum upload size.' })
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
        persistLink: input.persistLink,
      })
    } catch (error) {
      if (isScopedAttachmentUploadError(error)) {
        const message = SCOPED_UPLOAD_ERROR_MESSAGES[error.code] ?? UPLOAD_FAILED_MESSAGE
        throw new CrudHttpError(error.status, { error: await translateAttachmentError(message) })
      }
      throw error
    }

    return {
      id: attachment.id,
      url: attachment.url ?? buildAttachmentFileUrl(attachment.id),
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      fileSize: attachment.fileSize,
    }
  }

  async readScoped(input: ReadScopedAttachmentInput): Promise<ReadScopedAttachmentResult> {
    const attachment = await this.findReadableScoped(input)
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

  async describeScoped(input: DescribeScopedAttachmentInput): Promise<DescribedScopedAttachment> {
    return toDescribedScopedAttachment(await this.findReadableScoped(input))
  }

  async listScopedOwnerAttachmentIds(input: ListScopedOwnerAttachmentIdsInput): Promise<string[]> {
    const { auth, expectedOwner } = input
    if (!auth.tenantId || !auth.orgId) return throwAttachmentAccessError(403)
    const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }
    const limit = Number.isSafeInteger(input.limit) ? Math.max(1, Math.min(input.limit, 100)) : 100
    const attachments = await findWithDecryption(
      this.em,
      Attachment,
      { ...expectedOwner, ...scope },
      { fields: ['id'], orderBy: { id: 'asc' }, limit },
      scope,
    )
    const described = await this.describeManyScoped({
      auth,
      items: attachments.map(({ id: attachmentId }) => ({ attachmentId, expectedOwner })),
    })
    return described.map(({ id }) => id)
  }

  async reassignScopedAttachments(input: ReassignScopedAttachmentsInput, em: EntityManager): Promise<boolean> {
    if (!em.isInTransaction()) throw new Error('[internal] Reassigning attachments requires a transaction')
    const { auth, attachmentIds, expectedOwner, destination } = input
    if (!auth.tenantId || !auth.orgId) return throwAttachmentAccessError(403)
    const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }
    const attachments = await findWithDecryption(
      em,
      Attachment,
      { id: { $in: attachmentIds }, ...expectedOwner, ...scope },
      { orderBy: { id: 'asc' }, lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
      scope,
    )
    if (attachments.length !== attachmentIds.length) return false

    if (attachments.length === 0) return true

    const partitionCodes = [...new Set(attachments.map((attachment) => attachment.partitionCode))]
    const partitions = await findWithDecryption(
      em,
      AttachmentPartition,
      { code: { $in: partitionCodes } },
      undefined,
      scope,
    )
    const partitionsByCode = new Map(partitions.map((partition) => [partition.code, partition]))
    if (partitionCodes.some((code) => !partitionsByCode.has(code))) return throwAttachmentAccessError(404)

    for (const partition of partitions) await ensureAttachmentPartitionProtection(em, partition)

    const context = this.resolveAccessContext?.()
    for (const attachment of attachments) {
      const partition = partitionsByCode.get(attachment.partitionCode)!
      const accessInput = { context, auth, partition, action: 'reassign' as const, requireAuthForPublic: true }
      const sourceAccess = await evaluateAttachmentAccess({ ...accessInput, attachment })
      if (!sourceAccess.ok) await throwAttachmentAccessError(sourceAccess.status)
      const destinationAccess = await evaluateAttachmentAccess({ ...accessInput, attachment: { ...attachment, ...destination } })
      if (!destinationAccess.ok) await throwAttachmentAccessError(destinationAccess.status)
    }
    for (const attachment of attachments) {
      attachment.entityId = destination.entityId
      attachment.recordId = destination.recordId
    }
    await em.flush()
    return true
  }

  async describeManyScoped(input: DescribeManyScopedAttachmentsInput): Promise<DescribedScopedAttachment[]> {
    if (input.items.length === 0) return []
    const { auth } = input
    const decryptionScope = { tenantId: auth.tenantId, organizationId: auth.orgId }
    const attachmentIds = [...new Set(input.items.map((item) => item.attachmentId))]
    const attachments = await findWithDecryption(
      this.em,
      Attachment,
      {
        id: { $in: attachmentIds },
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
      },
      undefined,
      decryptionScope,
    )
    const attachmentsById = new Map(attachments.map((attachment) => [attachment.id, attachment]))
    const partitionCodes = [...new Set(attachments.map((attachment) => attachment.partitionCode))]
    const partitions = partitionCodes.length
      ? await findWithDecryption(this.em, AttachmentPartition, { code: { $in: partitionCodes }, ...attachmentPartitionVisibility(decryptionScope) }, undefined, decryptionScope)
      : []
    const partitionsByCode = indexAttachmentPartitions(partitions)

    const accessContext = this.resolveAccessContext?.()
    const described: DescribedScopedAttachment[] = []
    for (const item of input.items) {
      const attachment = attachmentsById.get(item.attachmentId)
      if (!attachment) throw new CrudHttpError(404, { error: 'Attachment not found' })
      const partition = partitionsByCode(attachment.partitionCode, attachment)
      if (!partition) throw new CrudHttpError(500, { error: 'Attachment partition is not configured' })
      await this.assertReadableScoped({ ...item, auth }, attachment, partition, accessContext)
      described.push(toDescribedScopedAttachment(attachment))
    }
    return described
  }

  private async findReadableScoped(input: DescribeScopedAttachmentInput): Promise<Attachment> {
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
    const partition = await resolveAttachmentPartition(this.em, attachment.partitionCode, attachment, { decrypt: true })
    if (!partition) throw new CrudHttpError(500, { error: 'Attachment partition is not configured' })
    await this.assertReadableScoped(input, attachment, partition, this.resolveAccessContext?.())
    return attachment
  }

  private async assertReadableScoped(
    input: DescribeScopedAttachmentInput,
    attachment: Attachment,
    partition: AttachmentPartition,
    accessContext: AttachmentAccessContext | undefined,
  ): Promise<void> {
    const access = await evaluateAttachmentAccess({
      auth: input.auth, attachment, partition, action: 'read',
      context: accessContext, requireAuthForPublic: true,
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
      const purge = await purgeDocumentStructure(
        em,
        { attachmentId: attachment.id, tenantId: input.tenantId, organizationId: input.organizationId },
        { flush: false },
      )
      em.remove(attachment)
      const { indexedSectionIds } = purge
      return async () => {
        if (indexedSectionIds.length > 0) await enqueuePurgedSectionSearchDelete(scope, indexedSectionIds)
        if (removal.releaseStorage) await deleteProviderBytes()
        await this.emitReleasedSideEffects(attachment)
      }
    }
    const removal = await removeAttachmentRecord(em, attachment)
    if (!removal.removed) throw new CrudHttpError(404, { error: 'Attachment not found' })
    if (removal.releaseStorage) await deleteProviderBytes()
    await this.emitReleasedSideEffects(attachment)
  }
}
