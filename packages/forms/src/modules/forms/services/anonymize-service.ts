import type { EntityManager } from '@mikro-orm/postgresql'
import {
  FormSubmission,
  FormSubmissionRevision,
  FormVersion,
} from '../data/entities'
import type { EncryptionService } from './encryption-service'
import type { CompiledFormVersion } from './form-version-compiler'
import type { FormVersionCompiler } from './form-version-compiler'

const ANONYMIZED_TOKEN = '__anonymized__'

export class AnonymizeServiceError extends Error {
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

  async anonymize(submissionId: string): Promise<{
    revisionsAnonymized: number
    submissionAnonymizedAt: Date
  }> {
    const em = this.options.em
    const submission = await em.findOne(FormSubmission, { id: submissionId })
    if (!submission) {
      throw new AnonymizeServiceError('SUBMISSION_NOT_FOUND', 'Submission not found.')
    }
    if (submission.anonymizedAt) {
      return {
        revisionsAnonymized: 0,
        submissionAnonymizedAt: submission.anonymizedAt,
      }
    }

    const formVersion = await em.findOne(FormVersion, { id: submission.formVersionId })
    if (!formVersion) {
      throw new AnonymizeServiceError('FORM_VERSION_NOT_FOUND', 'Form version not found.')
    }
    const compiled: CompiledFormVersion = this.options.compiler.compile({
      id: formVersion.id,
      updatedAt: formVersion.updatedAt,
      schema: formVersion.schema,
      uiSchema: formVersion.uiSchema,
    })

    const revisions = await em.find(
      FormSubmissionRevision,
      { submissionId: submission.id },
      { orderBy: { revisionNumber: 'asc' } },
    )

    let anonymizedCount = 0
    const now = new Date()
    for (const revision of revisions) {
      if (revision.anonymizedAt) continue
      const plaintext = await this.options.encryption.decrypt(submission.organizationId, revision.data)
      const decoded = JSON.parse(plaintext.toString('utf-8')) as Record<string, unknown>
      const tombstoned = applyTombstone(decoded, compiled)
      const buffer = Buffer.from(JSON.stringify(tombstoned), 'utf-8')
      const reencrypted = await this.options.encryption.encrypt(submission.organizationId, buffer)
      revision.data = reencrypted
      revision.anonymizedAt = now
      anonymizedCount += 1
    }

    submission.anonymizedAt = now
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
