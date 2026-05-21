/**
 * W5 (DP-5) — GDPR data-subject export (Art. 15 access / Art. 20 portability).
 *
 * Builds a structured, machine-readable JSON document for a data subject (a
 * `(subjectType, subjectId)` pair) or a single submission. The document
 * contains, per submission: the form key/name, the pinned version number,
 * status + lifecycle timestamps, and the DECRYPTED current-revision answers
 * keyed by field with human labels and types pulled from the compiled
 * `fieldIndex`. Signature answers contribute structured metadata (signed-at,
 * consent-clause SHA, mode) rather than the raw image blob. Large
 * blobs / uploads are referenced by attachment id, never inlined.
 *
 * This is a FULL data-subject export — it is NOT role-sliced. The caller is
 * responsible for the `forms.submissions.export` feature gate + audit row.
 *
 * Tenant isolation: every read is scoped by `organizationId` + `tenantId`.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import {
  Form,
  FormAttachment,
  FormSubmission,
  FormSubmissionRevision,
  FormVersion,
} from '../data/entities'
import type { EncryptionService } from './encryption-service'
import type { FormVersionCompiler, FieldDescriptor } from './form-version-compiler'
import { SIGNATURE_TYPE_KEY } from '../schema/signature-field'

const EXPORT_DOCUMENT_VERSION = '1' as const

type Scope = {
  organizationId: string
  tenantId: string
}

export class ExportServiceError extends Error {
  readonly code: 'SUBMISSION_NOT_FOUND'
  constructor(message: string) {
    super(message)
    this.code = 'SUBMISSION_NOT_FOUND'
    this.name = 'ExportServiceError'
  }
}

/** Locale-resolved label for a field, falling back through the field key. */
function resolveLabel(
  descriptor: FieldDescriptor | undefined,
  schema: Record<string, unknown> | null,
  fieldKey: string,
  locale: string,
): string {
  const properties = (schema?.properties ?? null) as Record<string, unknown> | null
  const node = properties && typeof properties[fieldKey] === 'object'
    ? (properties[fieldKey] as Record<string, unknown>)
    : null
  const labelMap = node?.['x-om-label']
  if (labelMap && typeof labelMap === 'object' && !Array.isArray(labelMap)) {
    const map = labelMap as Record<string, unknown>
    const localized = map[locale] ?? map.en
    if (typeof localized === 'string' && localized.length > 0) return localized
    const first = Object.values(map).find((value) => typeof value === 'string' && value.length > 0)
    if (typeof first === 'string') return first
  }
  if (descriptor) return descriptor.key
  return fieldKey
}

/** Signature metadata surfaced in the export (no raw image blob). */
export type ExportedSignatureMeta = {
  mode: string | null
  signedAt: string | null
  clauseSha256: string | null
  typedName: string | null
  hasImage: boolean
}

export type ExportedAnswer = {
  fieldKey: string
  label: string
  type: string
  sensitive: boolean
  /**
   * The decrypted answer value. For signature fields the raw image data URL
   * is stripped — `signature` carries the structured metadata instead.
   */
  value: unknown
  signature?: ExportedSignatureMeta
}

export type ExportedSubmission = {
  submissionId: string
  formKey: string
  formName: string
  formVersionId: string
  versionNumber: number
  status: string
  subjectType: string
  subjectId: string
  startedAt: string | null
  submittedAt: string | null
  updatedAt: string
  anonymizedAt: string | null
  currentRevisionId: string | null
  currentRevisionNumber: number | null
  answers: ExportedAnswer[]
  /** PDF / upload artifacts referenced by id — never inlined. */
  attachments: ExportedAttachmentRef[]
}

export type ExportedAttachmentRef = {
  attachmentId: string
  fieldKey: string
  kind: string
  filename: string | null
  contentType: string | null
  sizeBytes: number | null
}

export type DataSubjectExportDocument = {
  exportVersion: typeof EXPORT_DOCUMENT_VERSION
  generatedAt: string
  subjectType: string
  subjectId: string
  organizationId: string
  submissionCount: number
  submissions: ExportedSubmission[]
}

export type ExportServiceOptions = {
  emFactory: () => EntityManager
  compiler: FormVersionCompiler
  encryption: EncryptionService
  now?: () => Date
}

export class ExportService {
  private readonly emFactory: () => EntityManager
  private readonly compiler: FormVersionCompiler
  private readonly encryption: EncryptionService
  private readonly now: () => Date

  constructor(options: ExportServiceOptions) {
    this.emFactory = options.emFactory
    this.compiler = options.compiler
    this.encryption = options.encryption
    this.now = options.now ?? (() => new Date())
  }

  /**
   * Build the full per-subject export. Returns the document plus the list of
   * accessed submission ids so the caller can write one audit row per
   * submission read.
   */
  async exportSubject(
    args: Scope & { subjectType: string; subjectId: string; locale?: string },
  ): Promise<{ document: DataSubjectExportDocument; submissionIds: string[] }> {
    const em = this.emFactory()
    const submissions = await em.find(
      FormSubmission,
      {
        organizationId: args.organizationId,
        tenantId: args.tenantId,
        subjectType: args.subjectType,
        subjectId: args.subjectId,
        deletedAt: null,
      },
      { orderBy: { firstSavedAt: 'asc' } },
    )

    const exported: ExportedSubmission[] = []
    for (const submission of submissions) {
      exported.push(await this.buildSubmission(em, submission, args))
    }

    const document: DataSubjectExportDocument = {
      exportVersion: EXPORT_DOCUMENT_VERSION,
      generatedAt: this.now().toISOString(),
      subjectType: args.subjectType,
      subjectId: args.subjectId,
      organizationId: args.organizationId,
      submissionCount: exported.length,
      submissions: exported,
    }
    return { document, submissionIds: exported.map((entry) => entry.submissionId) }
  }

  /** Build a single-submission export (scoped). */
  async exportSubmission(
    args: Scope & { submissionId: string; locale?: string },
  ): Promise<{ document: ExportedSubmission; submissionIds: string[] }> {
    const em = this.emFactory()
    const submission = await em.findOne(FormSubmission, {
      id: args.submissionId,
      organizationId: args.organizationId,
      tenantId: args.tenantId,
      deletedAt: null,
    })
    if (!submission) {
      throw new ExportServiceError('Submission not found.')
    }
    const document = await this.buildSubmission(em, submission, args)
    return { document, submissionIds: [submission.id] }
  }

  private async buildSubmission(
    em: EntityManager,
    submission: FormSubmission,
    scope: Scope & { locale?: string },
  ): Promise<ExportedSubmission> {
    const formVersion = await em.findOne(FormVersion, {
      id: submission.formVersionId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })
    const form = formVersion
      ? await em.findOne(Form, {
          id: formVersion.formId,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
        })
      : null
    const locale = scope.locale ?? form?.defaultLocale ?? 'en'

    const revision = submission.currentRevisionId
      ? await em.findOne(FormSubmissionRevision, {
          id: submission.currentRevisionId,
          submissionId: submission.id,
          organizationId: scope.organizationId,
        })
      : null

    const decoded = revision ? await this.decodeRevision(scope.organizationId, revision) : {}

    const compiled = formVersion
      ? this.compiler.compile({
          id: formVersion.id,
          updatedAt: formVersion.updatedAt,
          schema: formVersion.schema,
          uiSchema: formVersion.uiSchema,
        })
      : null
    const fieldIndex = compiled?.fieldIndex ?? {}
    const schema = (formVersion?.schema ?? null) as Record<string, unknown> | null

    const answers: ExportedAnswer[] = []
    for (const [fieldKey, value] of Object.entries(decoded)) {
      const descriptor = fieldIndex[fieldKey]
      const type = descriptor?.type ?? 'unknown'
      const answer: ExportedAnswer = {
        fieldKey,
        label: resolveLabel(descriptor, schema, fieldKey, locale),
        type,
        sensitive: descriptor?.sensitive ?? false,
        value,
      }
      if (type === SIGNATURE_TYPE_KEY) {
        answer.signature = extractSignatureMeta(value)
        answer.value = redactSignatureValue(value)
      }
      answers.push(answer)
    }

    const attachments = await em.find(FormAttachment, {
      submissionId: submission.id,
      organizationId: scope.organizationId,
      removedAt: null,
    })

    return {
      submissionId: submission.id,
      formKey: form?.key ?? '',
      formName: form?.name ?? '',
      formVersionId: submission.formVersionId,
      versionNumber: formVersion?.versionNumber ?? 0,
      status: submission.status,
      subjectType: submission.subjectType,
      subjectId: submission.subjectId,
      startedAt: submission.firstSavedAt ? submission.firstSavedAt.toISOString() : null,
      submittedAt: submission.submittedAt ? submission.submittedAt.toISOString() : null,
      updatedAt: submission.updatedAt.toISOString(),
      anonymizedAt: submission.anonymizedAt ? submission.anonymizedAt.toISOString() : null,
      currentRevisionId: submission.currentRevisionId ?? null,
      currentRevisionNumber: revision?.revisionNumber ?? null,
      answers,
      attachments: attachments.map((attachment) => ({
        attachmentId: attachment.id,
        fieldKey: attachment.fieldKey,
        kind: attachment.kind,
        filename: attachment.filename ?? null,
        contentType: attachment.contentType ?? null,
        sizeBytes: attachment.sizeBytes ?? null,
      })),
    }
  }

  private async decodeRevision(
    organizationId: string,
    revision: FormSubmissionRevision,
  ): Promise<Record<string, unknown>> {
    const ciphertext = ensureBuffer(revision.data)
    if (ciphertext.length === 0) return {}
    const plain = await this.encryption.decrypt(organizationId, ciphertext)
    if (plain.length === 0) return {}
    try {
      const parsed = JSON.parse(plain.toString('utf8'))
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }
}

function ensureBuffer(value: Buffer | Uint8Array | string): Buffer {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (typeof value === 'string') return Buffer.from(value, 'binary')
  return Buffer.alloc(0)
}

function extractSignatureMeta(value: unknown): ExportedSignatureMeta {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { mode: null, signedAt: null, clauseSha256: null, typedName: null, hasImage: false }
  }
  const candidate = value as Record<string, unknown>
  return {
    mode: typeof candidate.mode === 'string' ? candidate.mode : null,
    signedAt: typeof candidate.signedAt === 'string' ? candidate.signedAt : null,
    clauseSha256: typeof candidate.clauseSha256 === 'string' ? candidate.clauseSha256 : null,
    typedName: typeof candidate.typedName === 'string' ? candidate.typedName : null,
    hasImage: typeof candidate.image === 'string' && candidate.image.length > 0,
  }
}

/** Strip the large data-URL image from a signature value; keep the rest. */
function redactSignatureValue(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const candidate = value as Record<string, unknown>
  if (!('image' in candidate)) return value
  const { image: _image, ...rest } = candidate
  return rest
}
