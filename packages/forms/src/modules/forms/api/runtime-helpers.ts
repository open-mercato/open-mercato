/**
 * Shared helpers for forms runtime API routes.
 */

import { NextResponse } from 'next/server'
import { SubmissionServiceError } from '../services/submission-service'
import { DistributionServiceError } from '../services/distribution-service'
import type { CompiledFormVersion } from '../services/form-version-compiler'
import type {
  Form,
  FormSubmission,
  FormSubmissionActor,
  FormSubmissionRevision,
  FormVersion,
} from '../data/entities'

export function mapSubmissionError(error: unknown): NextResponse {
  if (error instanceof SubmissionServiceError) {
    return NextResponse.json(
      { error: error.code, message: error.message, details: error.details ?? null },
      { status: error.httpStatus },
    )
  }
  const message = error instanceof Error ? error.message : 'Unknown error'
  return NextResponse.json({ error: 'INTERNAL_ERROR', message }, { status: 500 })
}

export function mapDistributionError(error: unknown): NextResponse {
  if (error instanceof DistributionServiceError) {
    return NextResponse.json(
      { error: error.code, message: error.message, details: error.details ?? null },
      { status: error.httpStatus },
    )
  }
  if (error instanceof SubmissionServiceError) {
    return mapSubmissionError(error)
  }
  const message = error instanceof Error ? error.message : 'Unknown error'
  return NextResponse.json({ error: 'INTERNAL_ERROR', message }, { status: 500 })
}

/**
 * Serializes the published form version a distribution serves into the same
 * shape the public renderer already understands (mirrors
 * `/api/forms/by-key/:key/active`), exposing the JSON schema, ui schema, and a
 * flattened field index. Anonymous participants are never sliced by caller
 * role here — the distribution carries the default actor role.
 */
export function serializeFormContext(args: {
  form: Form
  formVersion: FormVersion
  compiled: CompiledFormVersion
}) {
  const { form, formVersion, compiled } = args
  const fieldIndex: Record<string, unknown> = {}
  for (const [fieldKey, descriptor] of Object.entries(compiled.fieldIndex)) {
    fieldIndex[fieldKey] = {
      key: descriptor.key,
      type: descriptor.type,
      sectionKey: descriptor.sectionKey,
      sensitive: descriptor.sensitive,
      editableBy: descriptor.editableBy,
      visibleTo: descriptor.visibleTo,
      required: descriptor.required,
    }
  }
  return {
    form: {
      key: form.key,
      name: form.name,
      defaultLocale: form.defaultLocale,
      supportedLocales: form.supportedLocales,
    },
    schema: formVersion.schema,
    ui_schema: formVersion.uiSchema,
    fieldIndex,
  }
}

export async function readJsonBody<T = unknown>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T
  } catch {
    throw new SubmissionServiceError('VALIDATION_FAILED', 'Invalid JSON body.', 400)
  }
}

export function serializeSubmission(submission: FormSubmission) {
  return {
    id: submission.id,
    organizationId: submission.organizationId,
    tenantId: submission.tenantId,
    formVersionId: submission.formVersionId,
    subjectType: submission.subjectType,
    subjectId: submission.subjectId,
    status: submission.status,
    currentRevisionId: submission.currentRevisionId ?? null,
    startedBy: submission.startedBy,
    submittedBy: submission.submittedBy ?? null,
    firstSavedAt: submission.firstSavedAt?.toISOString() ?? null,
    submittedAt: submission.submittedAt?.toISOString() ?? null,
    submitMetadata: submission.submitMetadata ?? null,
    pdfSnapshotAttachmentId: submission.pdfSnapshotAttachmentId ?? null,
    anonymizedAt: submission.anonymizedAt?.toISOString() ?? null,
    createdAt: submission.createdAt?.toISOString() ?? null,
    updatedAt: submission.updatedAt?.toISOString() ?? null,
  }
}

export function serializeRevision(revision: FormSubmissionRevision) {
  return {
    id: revision.id,
    submissionId: revision.submissionId,
    revisionNumber: revision.revisionNumber,
    encryptionKeyVersion: revision.encryptionKeyVersion,
    savedAt: revision.savedAt?.toISOString() ?? null,
    savedBy: revision.savedBy,
    savedByRole: revision.savedByRole,
    changeSource: revision.changeSource,
    changedFieldKeys: revision.changedFieldKeys ?? [],
    changeSummary: revision.changeSummary ?? null,
    anonymizedAt: revision.anonymizedAt?.toISOString() ?? null,
  }
}

export function serializeActor(actor: FormSubmissionActor) {
  return {
    id: actor.id,
    submissionId: actor.submissionId,
    userId: actor.userId,
    role: actor.role,
    assignedAt: actor.assignedAt?.toISOString() ?? null,
    revokedAt: actor.revokedAt?.toISOString() ?? null,
  }
}
