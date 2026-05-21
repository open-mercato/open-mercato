/**
 * Public/anonymous attachment download —
 * GET /api/forms/public/submissions/:id/attachments/:attachmentId
 *
 * Streams a decrypted user-upload attachment back to the owning participant so
 * they can preview / confirm what they uploaded. Authorized via
 * `resolveRuntimePrincipal` (bearer access token OR portal session); org/tenant
 * are re-derived from the persisted submission (R-2d-4). Cross-tenant ids
 * return 404 (no enumeration).
 */

import { NextResponse, type NextRequest } from 'next/server'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { AttachmentService } from '../../../../../services/attachment-service'
import { resolveRuntimePrincipal } from '../../../../../lib/runtime-principal'
import { mapAttachmentError } from '../../../../attachment-helpers'

export const metadata = {
  GET: { requireAuth: false },
}

export async function GET(
  req: NextRequest,
  context: { params: { id: string; attachmentId: string } | Promise<{ id: string; attachmentId: string }> },
) {
  const params = await Promise.resolve(context.params)
  const submissionId = String(params.id)
  const attachmentId = String(params.attachmentId)

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const service = container.resolve('formsAttachmentService') as AttachmentService

  const principal = await resolveRuntimePrincipal({ req, submissionId, em })
  if (!principal) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  try {
    const result = await service.readUpload({
      organizationId: principal.organizationId,
      tenantId: principal.tenantId,
      submissionId,
      attachmentId,
    })
    const safeName = result.filename.replace(/["\\\r\n]/g, '_') || 'attachment'
    return new NextResponse(result.bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        'content-type': result.contentType || 'application/octet-stream',
        'content-disposition': `attachment; filename="${safeName}"`,
      },
    })
  } catch (error) {
    return mapAttachmentError(error)
  }
}

const getMethodDoc: OpenApiMethodDoc = {
  summary: 'Download a submission attachment (public/anonymous)',
  description: 'Streams the decrypted user-upload bytes for the owning participant. Authorized via access token or portal session.',
  tags: ['Forms Public Runtime'],
  responses: [{ status: 200, description: 'Attachment stream', mediaType: 'application/octet-stream' }],
  errors: [
    { status: 401, description: 'Missing or invalid access token / session' },
    { status: 404, description: 'Attachment not found' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Public attachment download',
  methods: { GET: getMethodDoc },
}
