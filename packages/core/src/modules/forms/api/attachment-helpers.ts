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
import { AttachmentServiceError, isAttachmentServiceError } from '../services/attachment-service'
import { resolveMaxUploadBytes } from '../services/upload-validation'

const MULTIPART_OVERHEAD_BYTES = 64 * 1024

export const SANDBOXED_DOWNLOAD_HEADERS = {
  'content-security-policy': "default-src 'none'; sandbox",
  'x-content-type-options': 'nosniff',
} as const

export type FieldUploadConfig = {
  fieldKey: string
  accept: string[] | null
  maxSizeBytes: number | null
  multiple: boolean
}

export function mapAttachmentError(error: unknown): NextResponse {
  if (isAttachmentServiceError(error)) {
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
export async function parseUploadBody(
  req: Request,
  maxFileBytes: number = resolveMaxUploadBytes(process.env),
): Promise<ParsedUpload | NextResponse> {
  const maxBodyBytes = maxFileBytes + MULTIPART_OVERHEAD_BYTES
  const declaredLength = Number(req.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    return NextResponse.json({ error: 'TOO_LARGE', message: 'Upload exceeds the allowed size.' }, { status: 413 })
  }

  const boundedBody = await readBoundedBody(req, maxBodyBytes)
  if (boundedBody instanceof NextResponse) return boundedBody

  let form: FormData
  try {
    const boundedRequest = new Request(req.url, {
      method: req.method,
      headers: req.headers,
      body: boundedBody as unknown as BodyInit,
    })
    form = await boundedRequest.formData()
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
  if (filePart.size > maxFileBytes) {
    return NextResponse.json({ error: 'TOO_LARGE', message: 'Upload exceeds the allowed size.' }, { status: 413 })
  }
  const arrayBuffer = await filePart.arrayBuffer()
  return {
    fieldKey: fieldKeyRaw,
    filename: filePart.name || 'upload',
    contentType: filePart.type || 'application/octet-stream',
    bytes: Buffer.from(arrayBuffer),
  }
}

async function readBoundedBody(req: Request, maxBodyBytes: number): Promise<Buffer | NextResponse> {
  if (!req.body) {
    return NextResponse.json({ error: 'VALIDATION_FAILED', message: 'Expected multipart/form-data.' }, { status: 422 })
  }

  const reader = req.body.getReader()
  const chunks: Buffer[] = []
  let totalBytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > maxBodyBytes) {
      await reader.cancel()
      return NextResponse.json({ error: 'TOO_LARGE', message: 'Upload exceeds the allowed size.' }, { status: 413 })
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks, totalBytes)
}
