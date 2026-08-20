import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
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

/**
 * The scoped upload service reports failures as machine codes; module-facing
 * callers get the same translation keys the public attachment route returns.
 */
const SCOPED_UPLOAD_ERROR_MESSAGES: Record<ScopedAttachmentUploadErrorCode, string> = {
  dangerous_executable: 'attachments.errors.dangerousExecutable',
  max_upload_size: 'attachments.errors.maxUploadSize',
  active_content: 'attachments.errors.activeContentBlocked',
  partition_unavailable: 'attachments.errors.partitionUnavailable',
  quota_exceeded: 'attachments.errors.quotaExceeded',
  quota_target_exists: 'attachments.errors.storagePathExists',
  quota_unavailable: 'attachments.errors.quotaUnavailable',
  quota_recovery_unsupported: 'attachments.errors.quotaRecoveryUnsupported',
  storage_failed: 'attachments.errors.storageFailed',
  persistence_failed: 'attachments.errors.persistenceFailed',
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
  ) {}

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
      throw new CrudHttpError(500, { error: 'attachments.errors.quotaUnavailable' })
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
        throw new CrudHttpError(error.status, { error: SCOPED_UPLOAD_ERROR_MESSAGES[error.code] ?? 'attachments.errors.uploadFailed' })
      }
      throw error
    }

    return {
      id: attachment.id,
      url: attachment.url ?? buildAttachmentFileUrl(attachment.id),
      fileName: attachment.fileName,
      mimeType: attachment.mimeType ?? '',
      fileSize: attachment.fileSize,
    }
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

    const access = checkAttachmentAccess(input.auth, attachment, partition, { requireAuthForPublic: true })
    if (!access.ok) {
      throw new CrudHttpError(access.status, { error: access.status === 401 ? 'Unauthorized' : 'Forbidden' })
    }
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
    em.remove(attachment)
    if (options.flush === false) {
      return deleteProviderBytes
    }
    await em.flush()
    await deleteProviderBytes()
  }
}
