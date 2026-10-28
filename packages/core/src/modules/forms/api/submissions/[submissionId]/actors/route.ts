/**
 * Admin API — POST /api/forms/submissions/:submissionId/actors
 *
 * Assigns a (user, role) pair to the submission. Requires
 * `forms.submissions.manage`. The role MUST be one of the form version's
 * declared roles; the SubmissionService validates this.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { SubmissionService } from '../../../../services/submission-service'
import { assignActorInputSchema } from '../../../../data/validators'
import { mapSubmissionError, readJsonBody, serializeActor } from '../../../runtime-helpers'

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

  let raw: unknown
  try {
    raw = await readJsonBody(req)
  } catch (error) {
    return mapSubmissionError(error)
  }
  const parsed = assignActorInputSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_FAILED', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const container = await createRequestContainer()
  const service = container.resolve('formsSubmissionService') as SubmissionService

  try {
    const actor = await service.assignActor({
      submissionId,
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      userId: parsed.data.user_id,
      role: parsed.data.role,
      assignedBy: auth.sub,
    })
    return NextResponse.json({ actor: serializeActor(actor) }, { status: 201 })
  } catch (error) {
    return mapSubmissionError(error)
  }
}

const errorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  details: z.unknown().optional(),
})

const responseSchema = z.object({ actor: z.record(z.string(), z.unknown()) })

const postMethodDoc: OpenApiMethodDoc = {
  summary: 'Assign an actor to a submission',
  description: 'Assigns a (user, role) pair as an active actor on the submission. The role MUST be declared on the form version.',
  tags: ['Forms Admin'],
  requestBody: { schema: assignActorInputSchema },
  responses: [{ status: 201, description: 'Actor assigned', schema: responseSchema }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 404, description: 'Submission not found', schema: errorSchema },
    { status: 422, description: 'Invalid role for the form version', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Assign submission actor',
  methods: { POST: postMethodDoc },
}
