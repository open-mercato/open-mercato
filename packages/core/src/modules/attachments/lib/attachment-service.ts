import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { Attachment, AttachmentPartition } from '../data/entities'
import { assertAttachmentScopeInvariant, checkAttachmentAccess } from './access'
import type { StorageDriverFactory } from './drivers'
import { buildAttachmentFileUrl } from './imageUrls'
import { readAttachmentMetadata, type AttachmentAssignment } from './metadata'
import {
  buildAttachmentContentDisposition,
  canRenderInlineAttachment,
  detectAttachmentMimeType,
  hasDangerousExecutableExtension,
  isActiveContentAttachment,
  sanitizeUploadedFileName,
} from './security'
import {
  isMultipartRequestWithinUploadLimit,
  resolveAttachmentMaxBytes,
  resolveAttachmentMultipartMaxBytes,
  willExceedAttachmentTenantQuota,
} from './upload-limits'

const logger = createLogger('attachments').child({ component: 'attachment-service' })

type AttachmentDatabase = {
  attachments: {
    file_size: number
    tenant_id: string | null
  }
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
  expectedAssignment?: AttachmentAssignment
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

async function readTenantUsageBytes(em: EntityManager, tenantId: string): Promise<number> {
  const db = em.getKysely<AttachmentDatabase>()
  const row = await db
    .selectFrom('attachments')
    .select(sql<string | number | null>`sum(file_size)`.as('total_size'))
    .where('tenant_id', '=', tenantId)
    .executeTakeFirst() as { total_size: string | number | null } | undefined
  const total = row?.total_size
  if (typeof total === 'number') return Number.isFinite(total) ? total : 0
  if (typeof total === 'string') {
    const parsed = Number(total)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
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
  constructor(
    private readonly em: EntityManager,
    private readonly storageDriverFactory: StorageDriverFactory,
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

    const safeName = sanitizeUploadedFileName(input.fileName)
    const mimeType = detectAttachmentMimeType(input.buffer, safeName, input.declaredMimeType ?? undefined)
    if (isActiveContentAttachment(input.buffer, safeName, mimeType)) {
      throw new CrudHttpError(400, { error: 'Active content uploads are not allowed.' })
    }

    const partition = await findOneWithDecryption(
      this.em,
      AttachmentPartition,
      { code: input.partitionCode },
      undefined,
      { tenantId: input.tenantId, organizationId: input.organizationId },
    )
    if (!partition) {
      throw new CrudHttpError(500, { error: 'Attachment partition is not configured' })
    }
    // Partition definitions are unencrypted configuration records keyed by a
    // globally unique code. A definition is usable only when global or scoped
    // to the same tenant and organization as the attachment.
    if (!partitionMatchesScope(partition, input.tenantId, input.organizationId)) {
      throw new CrudHttpError(403, { error: 'Attachment partition is not accessible for this scope' })
    }
    if (partition.isPublic) {
      throw new CrudHttpError(403, { error: 'Public attachment partitions cannot store scoped module files' })
    }

    const driver = await this.storageDriverFactory.resolveForPartition(partition.code, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })
    const attachmentId = randomUUID()
    let storedPath: string | null = null

    try {
      await this.em.transactional(async (tx) => {
        const db = tx.getKysely<AttachmentDatabase>()
        const quotaLockKey = `attachments:tenant-quota:${input.tenantId}`
        // Serialize quota check + row creation for a tenant. This is a real
        // reservation: concurrent uploads cannot all observe the same usage.
        await sql`select pg_advisory_xact_lock(hashtext(${quotaLockKey}))`.execute(db)
        const tenantUsageBytes = await readTenantUsageBytes(tx, input.tenantId)
        if (willExceedAttachmentTenantQuota(tenantUsageBytes, input.buffer.length)) {
          throw new CrudHttpError(413, { error: 'Attachment storage quota exceeded for this tenant.' })
        }

        const stored = await driver.store({
          partitionCode: partition.code,
          orgId: input.organizationId,
          tenantId: input.tenantId,
          fileName: safeName,
          buffer: input.buffer,
        })
        storedPath = stored.storagePath

        const attachment = tx.create(Attachment, {
          id: attachmentId,
          entityId: input.entityId,
          recordId: input.recordId,
          organizationId: input.organizationId,
          tenantId: input.tenantId,
          partitionCode: partition.code,
          fileName: safeName,
          mimeType,
          fileSize: input.buffer.length,
          storageDriver: partition.storageDriver || 'local',
          storagePath: stored.storagePath,
          storageMetadata: { assignments: input.assignments ?? [] },
          url: buildAttachmentFileUrl(attachmentId),
          content: null,
        })
        tx.persist(attachment)
        await input.persistLink?.(tx, attachmentId)
        await tx.flush()
      })
    } catch (error) {
      if (storedPath) {
        await driver.delete(partition.code, storedPath).catch((cleanupError) => {
          logger.error('Failed to clean up stored attachment after transaction failure', {
            err: cleanupError,
            attachmentId,
            partitionCode: partition.code,
          })
        })
      }
      throw error
    }

    return {
      id: attachmentId,
      url: buildAttachmentFileUrl(attachmentId),
      fileName: safeName,
      mimeType,
      fileSize: input.buffer.length,
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
    if (input.expectedAssignment) {
      const assignments = readAttachmentMetadata(attachment.storageMetadata).assignments ?? []
      if (!assignments.some((candidate) => assignmentMatches(candidate, input.expectedAssignment!))) {
        throw new CrudHttpError(409, { error: 'Attachment is still referenced by another record' })
      }
      if (assignments.some((candidate) => !assignmentMatches(candidate, input.expectedAssignment!))) {
        throw new CrudHttpError(409, { error: 'Attachment is still referenced by another record' })
      }
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
