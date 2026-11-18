/**
 * Admin attachment download —
 * GET /api/forms/submissions/:submissionId/attachments/:attachmentId
 *
 * Streams a decrypted user-upload attachment to an authorized admin. Scoped by
 * org+tenant from the backend session; cross-tenant ids return 404 (no
 * enumeration). Writes an access-audit row with `access_purpose = 'export'`.
 */

import { NextResponse, type NextRequest } from 'next/server'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { AttachmentService } from '../../../../../services/attachment-service'
import type { AccessAuditLogger } from '../../../../../services/access-audit-logger'
import { mapAttachmentError } from '../../../../attachment-helpers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['forms.view'] },
}

export async function GET(
  req: NextRequest,
  context: { params: { submissionId: string; attachmentId: string } | Promise<{ submissionId: string; attachmentId: string }> },
) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!auth.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Tenant scope required' }, { status: 403 })
  }
  const params = await Promise.resolve(context.params)
  const submissionId = String(params.submissionId)
  const attachmentId = String(params.attachmentId)

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const service = container.resolve('formsAttachmentService') as AttachmentService
  const auditor = container.resolve('formsAccessAuditLogger') as AccessAuditLogger

  try {
    const result = await service.readUpload({
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      submissionId,
      attachmentId,
    })
    await auditor.log(em, {
      organizationId: auth.orgId,
      submissionId,
      accessedBy: auth.sub,
      accessPurpose: 'export',
      ip: req.headers.get('x-forwarded-for') ?? null,
      ua: req.headers.get('user-agent') ?? null,
    })
    return streamAttachment(result)
  } catch (error) {
    return mapAttachmentError(error)
  }
}

function streamAttachment(result: { filename: string; contentType: string; bytes: Buffer }): NextResponse {
  const safeName = result.filename.replace(/["\\\r\n]/g, '_') || 'attachment'
  return new NextResponse(result.bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'content-type': result.contentType || 'application/octet-stream',
      'content-disposition': `attachment; filename="${safeName}"`,
    },
  })
}

const getMethodDoc: OpenApiMethodDoc = {
  summary: 'Download a submission attachment (admin)',
  description: 'Streams the decrypted user-upload bytes. Writes an access-audit row with access_purpose = "export".',
  tags: ['Forms Compliance'],
  responses: [{ status: 200, description: 'Attachment stream', mediaType: 'application/octet-stream' }],
  errors: [
    { status: 401, description: 'Not authenticated' },
    { status: 403, description: 'Tenant scope required' },
    { status: 404, description: 'Attachment not found' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Admin attachment download',
  methods: { GET: getMethodDoc },
}
