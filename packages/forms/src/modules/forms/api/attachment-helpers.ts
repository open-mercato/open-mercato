/**
 * Shared helpers for the W4 attachment upload / download routes.
 *
 * Resolves the per-field upload config (`x-om-accept`, `x-om-max-size-bytes`,
 * `x-om-multiple`) from the submission's pinned form version — the server is
 * authoritative; the client never supplies these constraints.
 */

import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { FormSubmission, FormVersion } from '../data/entities'
import { AttachmentServiceError } from '../services/attachment-service'

export type FieldUploadConfig = {
  fieldKey: string
  accept: string[] | null
  maxSizeBytes: number | null
  multiple: boolean
}

export function mapAttachmentError(error: unknown): NextResponse {
  if (error instanceof AttachmentServiceError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus })
  }
  const message = error instanceof Error ? error.message : 'Unknown error'
  return NextResponse.json({ error: 'INTERNAL_ERROR', message }, { status: 500 })
}

/**
 * Looks up the `file`-typed field node on the submission's pinned form version
 * and reads its upload config. Returns `null` when the submission, version, or
 * field is missing, or when the field is not a `file` type. Scope is enforced
 * by org+tenant on both reads.
 */
export async function resolveFieldUploadConfig(
  em: EntityManager,
  args: { organizationId: string; tenantId: string; submissionId: string; fieldKey: string },
): Promise<FieldUploadConfig | null> {
  const submission = await em.findOne(FormSubmission, {
    id: args.submissionId,
    organizationId: args.organizationId,
    tenantId: args.tenantId,
    deletedAt: null,
  })
  if (!submission) return null

  const version = await em.findOne(FormVersion, {
    id: submission.formVersionId,
    organizationId: args.organizationId,
    tenantId: args.tenantId,
  })
  if (!version) return null

  const properties = (version.schema as Record<string, unknown>).properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return null
  const node = (properties as Record<string, unknown>)[args.fieldKey]
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null

  const record = node as Record<string, unknown>
  if (record['x-om-type'] !== 'file') return null

  const acceptRaw = record['x-om-accept']
  const accept = Array.isArray(acceptRaw)
    ? acceptRaw.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : null
  const maxRaw = record['x-om-max-size-bytes']
  const maxSizeBytes = typeof maxRaw === 'number' && Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : null

  return {
    fieldKey: args.fieldKey,
    accept: accept && accept.length > 0 ? accept : null,
    maxSizeBytes,
    multiple: record['x-om-multiple'] === true,
  }
}

export type ParsedUpload = {
  fieldKey: string
  filename: string
  contentType: string
  bytes: Buffer
}

/**
 * Parses a multipart/form-data upload body. Expects a `file` part and a
 * `field_key` text part. Returns a 422 response describing the failure when
 * the body is malformed.
 */
export async function parseUploadBody(req: Request): Promise<ParsedUpload | NextResponse> {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'VALIDATION_FAILED', message: 'Expected multipart/form-data.' }, { status: 422 })
  }
  const fieldKeyRaw = form.get('field_key')
  if (typeof fieldKeyRaw !== 'string' || fieldKeyRaw.length === 0) {
    return NextResponse.json({ error: 'VALIDATION_FAILED', message: 'Missing field_key.' }, { status: 422 })
  }
  const filePart = form.get('file')
  if (!(filePart instanceof File)) {
    return NextResponse.json({ error: 'VALIDATION_FAILED', message: 'Missing file part.' }, { status: 422 })
  }
  const arrayBuffer = await filePart.arrayBuffer()
  return {
    fieldKey: fieldKeyRaw,
    filename: filePart.name || 'upload',
    contentType: filePart.type || 'application/octet-stream',
    bytes: Buffer.from(arrayBuffer),
  }
}
