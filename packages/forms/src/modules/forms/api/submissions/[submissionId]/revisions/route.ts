/**
 * Admin API — GET /api/forms/submissions/:submissionId/revisions
 *
 * Returns the revision timeline. The revision payload itself is NOT decoded
 * here — phase 2a's diff/replay viewer handles per-revision decryption.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { SubmissionService } from '../../../../services/submission-service'
import { mapSubmissionError, serializeRevision, serializeSubmission } from '../../../runtime-helpers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['forms.view'] },
}

export async function GET(
  req: NextRequest,
  context: { params: { submissionId: string } | Promise<{ submissionId: string }> },
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

  const container = await createRequestContainer()
  const service = container.resolve('formsSubmissionService') as SubmissionService

  try {
    const result = await service.listRevisions({
      submissionId,
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      viewerUserId: auth.sub,
      viewerRole: 'admin',
    })
    return NextResponse.json({
      submission: serializeSubmission(result.submission),
      revisions: result.revisions.map(serializeRevision),
    })
  } catch (error) {
    return mapSubmissionError(error)
  }
}

const errorSchema = z.object({ error: z.string(), message: z.string().optional() })

const responseSchema = z.object({
  submission: z.record(z.string(), z.unknown()),
  revisions: z.array(z.record(z.string(), z.unknown())),
})

const getMethodDoc: OpenApiMethodDoc = {
  summary: 'List submission revisions',
  description: 'Returns the append-only revision timeline for an admin viewer.',
  tags: ['Forms Admin'],
  responses: [{ status: 200, description: 'Revisions', schema: responseSchema }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 404, description: 'Submission not found', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Admin submission revisions',
  methods: { GET: getMethodDoc },
}
