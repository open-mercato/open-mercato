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
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { FormAttachment } from '../../../../../../data/entities'
import type { AttachmentService } from '../../../../../../services/attachment-service'
import type { FormVersionCompiler } from '../../../../../../services/form-version-compiler'
import type { RolePolicyService } from '../../../../../../services/role-policy-service'
import { resolveRuntimePrincipal } from '../../../../../../lib/runtime-principal'
import {
  mapAttachmentError,
  resolveAttachmentRolePolicy,
  SANDBOXED_DOWNLOAD_HEADERS,
} from '../../../../../attachment-helpers'
import { buildPublicRateLimitKey, enforcePublicRateLimit } from '../../../../rate-limit'

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

  const limited = await enforcePublicRateLimit(
    req,
    buildPublicRateLimitKey('submission-attachment', submissionId, attachmentId),
  )
  if (limited) return limited

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const service = container.resolve('formsAttachmentService') as AttachmentService

  const principal = await resolveRuntimePrincipal({ req, submissionId, em })
  if (!principal) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  try {
    const scope = { organizationId: principal.organizationId, tenantId: principal.tenantId }
    const policy = await resolveAttachmentRolePolicy(em, {
      ...scope,
      submissionId,
      role: principal.role,
    }, container.resolve('formVersionCompiler') as FormVersionCompiler,
    container.resolve('formsRolePolicyService') as RolePolicyService)
    if (!policy) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

    const attachment = await findOneWithDecryption(em, FormAttachment, {
      id: attachmentId,
      submissionId,
      organizationId: principal.organizationId,
      kind: 'user_upload',
      removedAt: null,
    }, { fields: ['fieldKey'] }, scope)
    if (!attachment || !policy.canRead(attachment.fieldKey)) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    }

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
        ...SANDBOXED_DOWNLOAD_HEADERS,
      },
    })
  } catch (error) {
    return mapAttachmentError(error)
  }
}

const getMethodDoc: OpenApiMethodDoc = {
  summary: 'Download a submission attachment (public/anonymous)',
  description: 'Streams decrypted user-upload bytes only when the participant role can read the attachment field in the submission’s pinned version. Authorized via access token or portal session.',
  tags: ['Forms Public Runtime'],
  responses: [{ status: 200, description: 'Attachment stream', mediaType: 'application/octet-stream' }],
  errors: [
    { status: 401, description: 'Missing or invalid access token / session' },
    { status: 404, description: 'Attachment not found' },
    { status: 429, description: 'Rate limit exceeded' },
    { status: 503, description: 'Rate limiting unavailable' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Public attachment download',
  methods: { GET: getMethodDoc },
}
