/**
 * Admin API — DELETE /api/forms/submissions/:submissionId/actors/:actorId
 *
 * Revokes the supplied actor row (sets `revoked_at`). Requires
 * `forms.submissions.manage`.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { SubmissionService } from '../../../../../../services/submission-service'
import { mapSubmissionError } from '../../../../../runtime-helpers'

export const metadata = {
  DELETE: { requireAuth: true, requireFeatures: ['forms.submissions.manage'] },
}

export async function DELETE(
  req: NextRequest,
  context: { params: { submissionId: string; actorId: string } | Promise<{ submissionId: string; actorId: string }> },
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
  const actorId = String(params.actorId)

  const container = await createRequestContainer()
  const service = container.resolve('formsSubmissionService') as SubmissionService

  try {
    await service.revokeActor({
      submissionId,
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      actorId,
      revokedBy: auth.sub,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return mapSubmissionError(error)
  }
}

const errorSchema = z.object({ error: z.string(), message: z.string().optional() })

const responseSchema = z.object({ ok: z.literal(true) })

const deleteMethodDoc: OpenApiMethodDoc = {
  summary: 'Revoke a submission actor',
  description: 'Revokes the supplied actor row by setting revoked_at.',
  tags: ['Forms Admin'],
  responses: [{ status: 200, description: 'Actor revoked', schema: responseSchema }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 404, description: 'Actor not found', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Revoke submission actor',
  methods: { DELETE: deleteMethodDoc },
}
