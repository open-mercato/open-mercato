/**
 * Form attachment service — W4 (FA-4 file + SEC-4).
 *
 * Stores participant uploads as `forms_form_attachment` rows
 * (`kind = 'user_upload'`) and reads them back. The raw bytes are encrypted at
 * rest with the per-tenant `EncryptionService` (DP-1: file bytes are PHI) and
 * persisted in `payload_inline`; the true `content_type` / `filename` /
 * `size_bytes` are recorded verbatim alongside.
 *
 * Tenant isolation: every query is scoped by BOTH `organization_id` AND
 * `tenant_id`. Callers MUST derive scope from the persisted submission row
 * (never the client). The submission row is re-fetched here and its scope is
 * compared with the caller's resolved scope; a mismatch is treated as
 * not-found (no cross-tenant leakage, no enumeration signal).
 *
 * Enforcement (server-authoritative):
 *   - empty / oversize → 413, disallowed MIME → 422 (`evaluateUploadGate`)
 *   - virus-scan hook → not-clean rejects with 422 (`UploadScanner`)
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { FormAttachment, FormSubmission } from '../data/entities'
import type { EncryptionService } from './encryption-service'
import type { UploadScanner } from './upload-scanner'
import { evaluateUploadGate, resolveMaxUploadBytes } from './upload-validation'

export type AttachmentServiceErrorCode =
  | 'NOT_FOUND'
  | 'EMPTY'
  | 'TOO_LARGE'
  | 'DISALLOWED_TYPE'
  | 'SCAN_REJECTED'

export class AttachmentServiceError extends Error {
  readonly code: AttachmentServiceErrorCode
  readonly httpStatus: number

  constructor(code: AttachmentServiceErrorCode, message: string, httpStatus: number) {
    super(message)
    this.name = 'AttachmentServiceError'
    this.code = code
    this.httpStatus = httpStatus
  }
}

type Scope = {
  organizationId: string
  tenantId: string
}

export type StoreUploadArgs = Scope & {
  submissionId: string
  fieldKey: string
  filename: string
  contentType: string
  bytes: Buffer
  uploadedBy: string | null
  /** Field-configured MIME allowlist (`x-om-accept`). */
  accept?: string[] | null
  /** Field-configured max size (`x-om-max-size-bytes`). */
  fieldMaxSizeBytes?: number | null
}

export type StoredAttachment = {
  id: string
  filename: string
  contentType: string
  sizeBytes: number
}

export type ReadAttachmentArgs = Scope & {
  submissionId: string
  attachmentId: string
}

export type ReadAttachmentResult = {
  id: string
  filename: string
  contentType: string
  sizeBytes: number
  bytes: Buffer
}

export type AttachmentServiceOptions = {
  emFactory: () => EntityManager
  encryptionService: EncryptionService
  scanner: UploadScanner
  /** Override the env-resolved hard ceiling (tests). */
  hardCeilingBytes?: number
}

export class AttachmentService {
  private readonly emFactory: () => EntityManager
  private readonly encryption: EncryptionService
  private readonly scanner: UploadScanner
  private readonly hardCeilingBytes: number

  constructor(options: AttachmentServiceOptions) {
    this.emFactory = options.emFactory
    this.encryption = options.encryptionService
    this.scanner = options.scanner
    this.hardCeilingBytes = options.hardCeilingBytes ?? resolveMaxUploadBytes(process.env)
  }

  /**
   * Validates, scans, encrypts, and persists an upload. Returns the reference
   * the renderer puts into the field value. The submission scope is re-derived
   * from the persisted row; a scope mismatch is reported as NOT_FOUND.
   */
  async storeUpload(args: StoreUploadArgs): Promise<StoredAttachment> {
    const em = this.emFactory()
    const submission = await this.findScopedSubmission(em, args)

    const sizeBytes = args.bytes.length
    const gate = evaluateUploadGate({
      contentType: args.contentType,
      sizeBytes,
      accept: args.accept ?? null,
      fieldMaxSizeBytes: args.fieldMaxSizeBytes ?? null,
      hardCeilingBytes: this.hardCeilingBytes,
    })
    if (!gate.ok) {
      throw new AttachmentServiceError(gate.code, gate.message, gate.status)
    }

    const scan = await this.scanner.scan({
      bytes: args.bytes,
      contentType: args.contentType,
      filename: args.filename,
    })
    if (!scan.clean) {
      throw new AttachmentServiceError(
        'SCAN_REJECTED',
        scan.reason && scan.reason.length > 0 ? scan.reason : 'Upload rejected by malware scan.',
        422,
      )
    }

    const ciphertext = await this.encryption.encrypt(submission.organizationId, args.bytes)
    const attachment = em.create(FormAttachment, {
      submissionId: submission.id,
      organizationId: submission.organizationId,
      fieldKey: args.fieldKey,
      kind: 'user_upload',
      payloadInline: ciphertext,
      contentType: args.contentType,
      filename: args.filename,
      sizeBytes,
      uploadedBy: args.uploadedBy ?? null,
    })
    em.persist(attachment)
    await em.flush()

    return {
      id: attachment.id,
      filename: args.filename,
      contentType: args.contentType,
      sizeBytes,
    }
  }

  /**
   * Reads and decrypts an attachment scoped to the submission's org/tenant.
   * Returns NOT_FOUND for cross-tenant ids, removed rows, snapshot/generated
   * kinds, or inline-less rows.
   */
  async readUpload(args: ReadAttachmentArgs): Promise<ReadAttachmentResult> {
    const em = this.emFactory()
    const submission = await this.findScopedSubmission(em, args)

    const attachment = await em.findOne(FormAttachment, {
      id: args.attachmentId,
      submissionId: submission.id,
      organizationId: submission.organizationId,
      kind: 'user_upload',
      removedAt: null,
    })
    if (!attachment || !attachment.payloadInline) {
      throw new AttachmentServiceError('NOT_FOUND', 'Attachment not found.', 404)
    }

    const ciphertext = Buffer.isBuffer(attachment.payloadInline)
      ? attachment.payloadInline
      : Buffer.from(attachment.payloadInline as Uint8Array)
    const bytes = await this.encryption.decrypt(submission.organizationId, ciphertext)
    return {
      id: attachment.id,
      filename: attachment.filename ?? '',
      contentType: attachment.contentType ?? 'application/octet-stream',
      sizeBytes: attachment.sizeBytes ?? bytes.length,
      bytes,
    }
  }

  private async findScopedSubmission(em: EntityManager, args: Scope & { submissionId: string }): Promise<FormSubmission> {
    const submission = await em.findOne(FormSubmission, {
      id: args.submissionId,
      organizationId: args.organizationId,
      tenantId: args.tenantId,
      deletedAt: null,
    })
    if (!submission) {
      throw new AttachmentServiceError('NOT_FOUND', 'Submission not found.', 404)
    }
    return submission
  }
}
