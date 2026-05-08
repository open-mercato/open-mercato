/**
 * Runtime API — POST /api/form-submissions/:id/submit
 *
 * Final submit. Body: `{ base_revision_id, submit_metadata? }`. Sets
 * status = submitted, captures `submit_metadata` (locale, IP, UA), emits
 * `forms.submission.submitted`. Idempotency hardening lands in 1d once the
 * client renderer is in place; phase 1c rejects double-submits with 422.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { SubmissionService } from '../../../../services/submission-service'
import { submissionSubmitInputSchema } from '../../../../data/validators'
import { mapSubmissionError, readJsonBody, serializeSubmission } from '../../../runtime-helpers'

export const metadata = {
  POST: { requireAuth: false },
}

export async function POST(
  req: NextRequest,
  context: { params: { id: string } | Promise<{ id: string }> },
) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const params = await Promise.resolve(context.params)
  const submissionId = String(params.id)

  let raw: unknown
  try {
    raw = await readJsonBody(req)
  } catch (error) {
    return mapSubmissionError(error)
  }
  const parsed = submissionSubmitInputSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_FAILED', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const container = await createRequestContainer()
  const service = container.resolve('formsSubmissionService') as SubmissionService

  try {
    const submission = await service.submit({
      submissionId,
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      baseRevisionId: parsed.data.base_revision_id,
      submittedBy: auth.sub,
      submitMetadata: parsed.data.submit_metadata ?? null,
    })
    return NextResponse.json({ submission: serializeSubmission(submission) })
  } catch (error) {
    return mapSubmissionError(error)
  }
}

const errorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  details: z.unknown().optional(),
})

const responseSchema = z.object({ submission: z.record(z.string(), z.unknown()) })

const postMethodDoc: OpenApiMethodDoc = {
  summary: 'Submit a form submission',
  description: 'Final submission of a draft submission. Verifies base_revision_id and stores the submit metadata.',
  tags: ['Forms Runtime'],
  requestBody: { schema: submissionSubmitInputSchema },
  responses: [{ status: 200, description: 'Submission submitted', schema: responseSchema }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 404, description: 'Submission not found', schema: errorSchema },
    { status: 409, description: 'Stale base_revision_id', schema: errorSchema },
    { status: 422, description: 'Submission already in terminal state', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Submit a form submission',
  methods: { POST: postMethodDoc },
}
