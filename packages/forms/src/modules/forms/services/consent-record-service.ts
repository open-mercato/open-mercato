/**
 * Consent-record projector service — Phase 3 Track D.
 *
 * Projects signed `signature`-typed field answers into the
 * `forms_consent_record` aggregate: a per-subject, per-clause history of
 * consent with supersession tracking. The projection is PII-free — it records
 * only the consent-clause SHA-256, the signed-at timestamp, and ids. It never
 * stores the signature image, typed name, or any answer value.
 *
 * Invariants:
 *  - Idempotent: at most one record per `(submission_id, consent_field_key)`.
 *    Re-delivery of `forms.submission.submitted` is a no-op (backed by a
 *    unique index as the second line of defence).
 *  - Supersession: creating a new `active` record marks any prior `active`
 *    record for the same `(organization_id, subject_type, subject_id,
 *    form_id, consent_field_key)` as `superseded` with a back-pointer.
 *  - Tenant-scoped: every read filters by `organization_id` AND `tenant_id`.
 *  - Fail-soft is the SUBSCRIBER's responsibility — this service throws on
 *    real errors so they surface in tests; the subscriber swallows them so a
 *    projection failure never breaks the submit pipeline.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { FormConsentRecord } from '../data/entities'
import type { FormVersion, FormSubmission } from '../data/entities'
import type { FormVersionCompiler } from './form-version-compiler'
import { SIGNATURE_TYPE_KEY, type SignatureValue } from '../schema/signature-field'

export type ConsentProjectionLoad = {
  submission: Pick<FormSubmission, 'id' | 'organizationId' | 'subjectType' | 'subjectId' | 'status'>
  formVersion: Pick<FormVersion, 'id' | 'formId' | 'versionNumber' | 'schema' | 'uiSchema' | 'updatedAt'>
  decodedData: Record<string, unknown>
}

export type ConsentProjectionLoader = (args: {
  submissionId: string
  organizationId: string
  tenantId: string
}) => Promise<ConsentProjectionLoad | null>

export type ConsentRecordServiceDeps = {
  emFactory: () => EntityManager
  compiler: Pick<FormVersionCompiler, 'compile'>
  loadSubmission: ConsentProjectionLoader
  now?: () => Date
}

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/

function readSignatureValue(value: unknown): SignatureValue | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (candidate.mode !== 'drawn' && candidate.mode !== 'typed') return null
  if (typeof candidate.clauseSha256 !== 'string' || !SHA256_HEX_PATTERN.test(candidate.clauseSha256)) return null
  if (typeof candidate.signedAt !== 'string' || Number.isNaN(Date.parse(candidate.signedAt))) return null
  return candidate as unknown as SignatureValue
}

export class ConsentRecordService {
  private readonly emFactory: () => EntityManager
  private readonly compiler: Pick<FormVersionCompiler, 'compile'>
  private readonly loadSubmission: ConsentProjectionLoader
  private readonly now: () => Date

  constructor(deps: ConsentRecordServiceDeps) {
    this.emFactory = deps.emFactory
    this.compiler = deps.compiler
    this.loadSubmission = deps.loadSubmission
    this.now = deps.now ?? (() => new Date())
  }

  /**
   * Projects every signed signature field on the submission into the consent
   * aggregate. Returns the records created (empty when there are no signature
   * fields, no signed values, or every clause is already recorded).
   */
  async projectFromSubmission(args: {
    submissionId: string
    organizationId: string
    tenantId: string
  }): Promise<FormConsentRecord[]> {
    const loaded = await this.loadSubmission(args)
    if (!loaded) return []
    const { submission, formVersion, decodedData } = loaded
    if (submission.status !== 'submitted') return []

    const compiled = this.compiler.compile({
      id: formVersion.id,
      updatedAt: formVersion.updatedAt,
      schema: formVersion.schema,
      uiSchema: formVersion.uiSchema,
    })

    const signatureFieldKeys = Object.values(compiled.fieldIndex)
      .filter((descriptor) => descriptor.type === SIGNATURE_TYPE_KEY)
      .map((descriptor) => descriptor.key)
    if (signatureFieldKeys.length === 0) return []

    const em = this.emFactory()
    const created: FormConsentRecord[] = []

    for (const consentFieldKey of signatureFieldKeys) {
      const signature = readSignatureValue(decodedData[consentFieldKey])
      if (!signature) continue

      // Idempotency: never project the same (submission, field) twice.
      const existing = await em.findOne(FormConsentRecord, {
        submissionId: submission.id,
        organizationId: args.organizationId,
        consentFieldKey,
      })
      if (existing) continue

      const nowDate = this.now()
      const record = em.create(FormConsentRecord, {
        organizationId: args.organizationId,
        tenantId: args.tenantId,
        subjectType: submission.subjectType,
        subjectId: submission.subjectId,
        formId: formVersion.formId,
        formVersionId: formVersion.id,
        versionNumber: formVersion.versionNumber,
        submissionId: submission.id,
        consentFieldKey,
        clauseSha256: signature.clauseSha256,
        signedAt: new Date(signature.signedAt),
        status: 'active',
        supersededByRecordId: null,
        supersededAt: null,
        createdAt: nowDate,
        updatedAt: nowDate,
      })
      em.persist(record)

      // Supersede any prior active record for the same subject + form + clause.
      const priorActive = await em.find(FormConsentRecord, {
        organizationId: args.organizationId,
        tenantId: args.tenantId,
        subjectType: submission.subjectType,
        subjectId: submission.subjectId,
        formId: formVersion.formId,
        consentFieldKey,
        status: 'active',
      })
      for (const prior of priorActive) {
        if (prior === record) continue
        prior.status = 'superseded'
        prior.supersededByRecordId = record.id
        prior.supersededAt = nowDate
        prior.updatedAt = nowDate
        em.persist(prior)
      }

      created.push(record)
    }

    if (created.length > 0) {
      await em.flush()
    }
    return created
  }
}
