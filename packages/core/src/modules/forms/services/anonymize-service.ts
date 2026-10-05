import type { EntityManager } from '@mikro-orm/postgresql'
import {
  FormAttachment,
  FormInvitation,
  FormSubmission,
  FormSubmissionRevision,
  FormVersion,
} from '../data/entities'
import type { EncryptionService } from './encryption-service'
import type { CompiledFormVersion } from './form-version-compiler'
import type { FormVersionCompiler } from './form-version-compiler'

const ANONYMIZED_TOKEN = '__anonymized__'

/**
 * `Symbol.for` so the brand survives module duplication across bundle
 * boundaries. `instanceof` does NOT: Next can load this module in more than
 * one chunk, and once a second copy of the class exists an error thrown
 * through one copy fails `instanceof` against the other — silently
 * downgrading a mapped domain error to a 500. Mirrors `CrudHttpError`.
 */
const ANONYMIZE_SERVICE_ERROR_MARKER = Symbol.for('@open-mercato/forms/AnonymizeServiceError')

export class AnonymizeServiceError extends Error {
  readonly [ANONYMIZE_SERVICE_ERROR_MARKER] = true
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'AnonymizeServiceError'
  }
}

export type AnonymizeServiceOptions = {
  em: EntityManager
  compiler: FormVersionCompiler
  encryption: EncryptionService
}

/**
 * Tenant/organization the caller is acting within. Required, not optional: this
 * operation is irreversible, so every call site must state its scope and the
 * compiler must reject any that does not.
 */
export type AnonymizeScope = {
  tenantId: string
  organizationId: string
}

/**
 * Phase 2b — `submission.anonymize` flow.
 *
 * Walks every revision of a submission, decrypts the payload, replaces the
 * value of any field flagged `x-om-sensitive: true` (per the pinned form
 * version's compiled `fieldIndex`) with a tombstone token, re-encrypts the
 * record, and stamps `anonymized_at`. Clears `submit_metadata` IP/UA on the
 * parent submission and stamps `anonymized_at` on the parent.
 *
 * Idempotency: revisions with `anonymized_at` set are skipped. Re-running
 * the command is safe — it only continues from where the previous run left
 * off.
 *
 * Irreversible per spec — the command surface forbids undo.
 */
export class AnonymizeService {
  constructor(private readonly options: AnonymizeServiceOptions) {}

  async anonymize(submissionId: string, scope: AnonymizeScope): Promise<{
    revisionsAnonymized: number
    submissionAnonymizedAt: Date
  }> {
    const em = this.options.em
    const submission = await em.findOne(FormSubmission, {
      id: submissionId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    if (!submission) {
      throw new AnonymizeServiceError('SUBMISSION_NOT_FOUND', 'Submission not found.')
    }
    const revisions = await em.find(
      FormSubmissionRevision,
      { submissionId: submission.id },
      { orderBy: { revisionNumber: 'asc' } },
    )
    const attachments = await em.find(FormAttachment, {
      submissionId: submission.id,
      organizationId: submission.organizationId,
    })
    const invitations = await em.find(FormInvitation, {
      submissionId: submission.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })

    const pendingRevisions = revisions.filter((revision) => !revision.anonymizedAt)
    let compiled: CompiledFormVersion | null = null
    if (pendingRevisions.length > 0) {
      const formVersion = await em.findOne(FormVersion, {
        id: submission.formVersionId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      })
      if (!formVersion) {
        throw new AnonymizeServiceError('FORM_VERSION_NOT_FOUND', 'Form version not found.')
      }
      compiled = this.options.compiler.compile({
        id: formVersion.id,
        updatedAt: formVersion.updatedAt,
        schema: formVersion.schema,
        uiSchema: formVersion.uiSchema,
      })
    }

    let anonymizedCount = 0
    const now = submission.anonymizedAt ?? new Date()
    for (const revision of pendingRevisions) {
      const plaintext = await this.options.encryption.decrypt(submission.organizationId, revision.data)
      const decoded = JSON.parse(plaintext.toString('utf-8')) as Record<string, unknown>
      const tombstoned = applyTombstone(decoded, compiled as CompiledFormVersion)
      const buffer = Buffer.from(JSON.stringify(tombstoned), 'utf-8')
      const reencrypted = await this.options.encryption.encrypt(submission.organizationId, buffer)
      revision.data = reencrypted
      revision.anonymizedAt = now
      anonymizedCount += 1
    }

    for (const attachment of attachments) {
      attachment.removedAt = attachment.removedAt ?? now
      attachment.payloadInline = null
      attachment.fileId = null
      attachment.contentType = null
      attachment.filename = null
      attachment.sizeBytes = null
      attachment.uploadedBy = null
    }

    for (const invitation of invitations) {
      invitation.recipientEmail = null
      invitation.recipientName = null
      invitation.recipientRef = null
    }

    submission.anonymizedAt = now
    submission.pdfSnapshotAttachmentId = null
    submission.submitMetadata = {
      anonymized_at: now.toISOString(),
    }
    await em.flush()

    return {
      revisionsAnonymized: anonymizedCount,
      submissionAnonymizedAt: now,
    }
  }
}

function applyTombstone(
  decoded: Record<string, unknown>,
  compiled: CompiledFormVersion,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...decoded }
  for (const [key, descriptor] of Object.entries(compiled.fieldIndex)) {
    if (!descriptor.sensitive) continue
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      result[key] = ANONYMIZED_TOKEN
    }
  }
  return result
}

export const ANONYMIZED_FIELD_TOKEN = ANONYMIZED_TOKEN

/** Brand check for AnonymizeServiceError — use instead of `instanceof`. */
export function isAnonymizeServiceError(error: unknown): error is AnonymizeServiceError {
  return typeof error === 'object' && error !== null && (ANONYMIZE_SERVICE_ERROR_MARKER in error)
}
