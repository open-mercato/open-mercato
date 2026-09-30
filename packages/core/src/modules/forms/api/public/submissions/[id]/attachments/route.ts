/**
 * Public/anonymous attachment upload —
 * POST /api/forms/public/submissions/:id/attachments
 *
 * Token- or portal-authenticated participants upload a file for a `file`-typed
 * field. Authorization goes through `resolveRuntimePrincipal` (bearer access
 * token OR customer session). Org/tenant are ALWAYS re-derived from the
 * persisted submission row (R-2d-4) — never trusted from the client. Bytes are
 * encrypted at rest and gated by MIME allowlist, size ceiling, and the
 * pluggable virus scanner (W4 / SEC-4).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { AttachmentService } from '../../../../../services/attachment-service'
import { resolveRuntimePrincipal } from '../../../../../lib/runtime-principal'
import {
  mapAttachmentError,
  parseUploadBody,
  resolveFieldUploadConfig,
} from '../../../../attachment-helpers'
import { enforcePublicRateLimit, getClientIp } from '../../../rate-limit'

export const metadata = {
  POST: { requireAuth: false },
}

export async function POST(
  req: NextRequest,
  context: { params: { id: string } | Promise<{ id: string }> },
) {
  const params = await Promise.resolve(context.params)
  const submissionId = String(params.id)

  const limited = await enforcePublicRateLimit(
    `forms:public:upload:${submissionId}:${getClientIp(req)}`,
  )
  if (limited) return limited

  const parsed = await parseUploadBody(req)
  if (parsed instanceof NextResponse) return parsed

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const service = container.resolve('formsAttachmentService') as AttachmentService

  const principal = await resolveRuntimePrincipal({ req, submissionId, em })
  if (!principal) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  const config = await resolveFieldUploadConfig(em, {
    organizationId: principal.organizationId,
    tenantId: principal.tenantId,
    submissionId,
    fieldKey: parsed.fieldKey,
  })
  if (!config) {
    return NextResponse.json({ error: 'INVALID_FIELD' }, { status: 422 })
  }

  try {
    const stored = await service.storeUpload({
      organizationId: principal.organizationId,
      tenantId: principal.tenantId,
      submissionId,
      fieldKey: parsed.fieldKey,
      filename: parsed.filename,
      contentType: parsed.contentType,
      bytes: parsed.bytes,
      uploadedBy: principal.source === 'customer' ? principal.principal : null,
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
  summary: 'Upload an attachment (public/anonymous)',
  description: 'Stores an encrypted file for a file-typed field. Authorized via access token or portal session.',
  tags: ['Forms Public Runtime'],
  responses: [{ status: 201, description: 'Attachment stored', schema: uploadResponseSchema }],
  errors: [
    { status: 401, description: 'Missing or invalid access token / session', schema: errorSchema },
    { status: 413, description: 'File empty or oversize', schema: errorSchema },
    { status: 422, description: 'Disallowed type / invalid field / scan rejected', schema: errorSchema },
    { status: 429, description: 'Rate limit exceeded', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Public attachment upload',
  methods: { POST: postMethodDoc },
}
