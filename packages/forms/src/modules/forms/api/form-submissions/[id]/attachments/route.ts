/**
 * Authenticated attachment upload — POST /api/forms/form-submissions/:id/attachments
 *
 * Customer-authenticated participants upload a file for a `file`-typed field.
 * The caller MUST be an active actor on the submission. Org/tenant scope is
 * derived from the customer session and the persisted submission row (never
 * the client). Bytes are encrypted at rest and gated by MIME allowlist, size
 * ceiling, and the pluggable virus scanner (W4 / SEC-4).
 *
 * Returns `{ id, filename, contentType, sizeBytes }`. The renderer puts the id
 * into the field value, which autosaves through the normal PATCH save path.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import type { AttachmentService } from '../../../../services/attachment-service'
import { FormSubmissionActor } from '../../../../data/entities'
import {
  mapAttachmentError,
  parseUploadBody,
  resolveFieldUploadConfig,
} from '../../../attachment-helpers'

export const metadata = {
  POST: { requireAuth: false },
}

export async function POST(
  req: NextRequest,
  context: { params: { id: string } | Promise<{ id: string }> },
) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }
  const params = await Promise.resolve(context.params)
  const submissionId = String(params.id)

  const parsed = await parseUploadBody(req)
  if (parsed instanceof NextResponse) return parsed

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const service = container.resolve('formsAttachmentService') as AttachmentService

  const actor = await em.findOne(FormSubmissionActor, {
    submissionId,
    organizationId: auth.orgId,
    userId: auth.sub,
    revokedAt: null,
    deletedAt: null,
  })
  if (!actor) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  const config = await resolveFieldUploadConfig(em, {
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    submissionId,
    fieldKey: parsed.fieldKey,
  })
  if (!config) {
    return NextResponse.json({ error: 'INVALID_FIELD' }, { status: 422 })
  }

  try {
    const stored = await service.storeUpload({
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      submissionId,
      fieldKey: parsed.fieldKey,
      filename: parsed.filename,
      contentType: parsed.contentType,
      bytes: parsed.bytes,
      uploadedBy: auth.sub,
      accept: config.accept,
      fieldMaxSizeBytes: config.maxSizeBytes,
    })
    return NextResponse.json(stored, { status: 201 })
  } catch (error) {
    return mapAttachmentError(error)
  }
}

const errorSchema = z.object({ error: z.string(), message: z.string().optional() })
const uploadResponseSchema = z.object({
  id: z.string(),
  filename: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
})

const postMethodDoc: OpenApiMethodDoc = {
  summary: 'Upload an attachment (authenticated)',
  description: 'Stores an encrypted file for a file-typed field. Caller must be an active actor on the submission.',
  tags: ['Forms Runtime'],
  responses: [{ status: 201, description: 'Attachment stored', schema: uploadResponseSchema }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'No active actor row for user', schema: errorSchema },
    { status: 413, description: 'File empty or oversize', schema: errorSchema },
    { status: 422, description: 'Disallowed type / invalid field / scan rejected', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Authenticated attachment upload',
  methods: { POST: postMethodDoc },
}
