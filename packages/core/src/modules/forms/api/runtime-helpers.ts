/**
 * Shared helpers for forms runtime API routes.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { SubmissionServiceError } from '../services/submission-service'
import { DistributionServiceError } from '../services/distribution-service'
import { readEmbedSettings } from '../lib/embed-frame-policy'
import type { CompiledFormVersion } from '../services/form-version-compiler'
import type {
  Form,
  FormDistribution,
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
 * Builds the authoritative submit metadata recorded on `form_submission`.
 *
 * Signing audit (CN-3): the IP, user-agent, and UTC submit timestamp are
 * derived SERVER-SIDE here — the client cannot forge them. Any client-supplied
 * `submit_metadata` (e.g. locale, timezone hints) is preserved but the
 * server-derived `ip` / `userAgent` / `serverSubmittedAt` always win.
 *
 * Together with the version-pinned (immutable) schema and the encrypted,
 * append-only revision answers (which carry the signature payload incl. the
 * consent clause SHA-256 and the signer's affirmation), this metadata forms
 * the tamper-evident signed record. Full PDF reproduction of that bundle is W3.
 */
export function buildSubmitMetadata(
  req: NextRequest,
  clientMetadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const forwardedFor = req.headers.get('x-forwarded-for')
  const ip = forwardedFor?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
  const userAgent = req.headers.get('user-agent') || null
  return {
    ...(clientMetadata ?? {}),
    ip,
    userAgent,
    serverSubmittedAt: new Date().toISOString(),
  }
}

/**
 * Serializes the published form version a distribution serves into the same
 * shape the public renderer already understands (mirrors
 * `/api/forms/by-key/:key/active`), exposing the JSON schema, ui schema, and a
 * flattened field index. Anonymous participants are never sliced by caller
 * role here — the distribution carries the default actor role.
 */
/**
 * Reads the optional `settings.completion.{title,message}` from a distribution
 * `settings` json bag, guarding for the untyped shape. Empty / whitespace-only
 * strings collapse to `null` so the renderer falls back to its default copy.
 */
function readCompletionCopy(
  settings: Record<string, unknown> | null | undefined,
): { title: string | null; message: string | null } {
  const completion =
    settings && typeof settings === 'object' && !Array.isArray(settings)
      ? (settings as Record<string, unknown>).completion
      : undefined
  if (!completion || typeof completion !== 'object' || Array.isArray(completion)) {
    return { title: null, message: null }
  }
  const record = completion as Record<string, unknown>
  const title = typeof record.title === 'string' && record.title.trim() ? record.title : null
  const message =
    typeof record.message === 'string' && record.message.trim() ? record.message : null
  return { title, message }
}

/**
 * Reads the PUBLIC-SAFE embed display hints from a distribution's `settings`
 * bag — `theme` and `autoResize` only, and only when embedding is enabled. The
 * framing allowlist (`allowedDomains`) is NEVER echoed to a public context
 * payload (R-RS-1); it is consumed exclusively server-side by the CSP builder.
 */
function readEmbedContext(
  distribution: FormDistribution | undefined,
): { theme: 'light' | 'dark' | 'auto' | null; autoResize: boolean } | null {
  const embed = readEmbedSettings(distribution?.settings)
  if (!embed || embed.enabled !== true) return null
  return {
    theme: embed.theme ?? null,
    autoResize: embed.autoResize !== false,
  }
}

export function serializeFormContext(args: {
  form: Form
  formVersion: FormVersion
  compiled: CompiledFormVersion
  distribution?: FormDistribution
}) {
  const { form, formVersion, compiled, distribution } = args
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
    completion: readCompletionCopy(distribution?.settings),
    redirect_url: distribution?.redirectUrl ?? null,
    embed: readEmbedContext(distribution),
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
