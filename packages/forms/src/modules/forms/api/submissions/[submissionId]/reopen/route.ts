/**
 * Admin API — POST /api/forms/submissions/:submissionId/reopen
 *
 * Transitions a submitted submission back to `reopened` so further saves are
 * allowed. Requires `forms.submissions.manage`.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { SubmissionService } from '../../../../../services/submission-service'
import { mapSubmissionError, serializeSubmission } from '../../../../runtime-helpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['forms.submissions.manage'] },
}

export async function POST(
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
    const submission = await service.reopen({
      submissionId,
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      reopenedBy: auth.sub,
    })
    return NextResponse.json({ submission: serializeSubmission(submission) })
  } catch (error) {
    return mapSubmissionError(error)
  }
}

const errorSchema = z.object({ error: z.string(), message: z.string().optional() })

const responseSchema = z.object({ submission: z.record(z.string(), z.unknown()) })

const postMethodDoc: OpenApiMethodDoc = {
  summary: 'Reopen a submitted submission',
  description: 'Transitions status from submitted back to reopened so further saves are allowed.',
  tags: ['Forms Admin'],
  responses: [{ status: 200, description: 'Submission reopened', schema: responseSchema }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 404, description: 'Submission not found', schema: errorSchema },
    { status: 422, description: 'Submission not in submitted state', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Reopen submission',
  methods: { POST: postMethodDoc },
}
