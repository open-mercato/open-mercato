/**
 * Runtime API — POST /api/form-submissions
 *
 * Starts a new submission for the active version of a form. Customer auth is
 * required. The starter is auto-assigned the form version's
 * `x-om-default-actor-role` (or first declared role) — admin assignment of
 * additional actors is the admin route.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { SubmissionService } from '../../services/submission-service'
import { submissionStartInputSchema } from '../../data/validators'
import { mapSubmissionError, readJsonBody, serializeActor, serializeRevision, serializeSubmission } from '../runtime-helpers'

export const metadata = {
  POST: { requireAuth: false },
}

export async function POST(req: NextRequest) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  let raw: unknown
  try {
    raw = await readJsonBody(req)
  } catch (error) {
    return mapSubmissionError(error)
  }
  const parsed = submissionStartInputSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_FAILED', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const container = await createRequestContainer()
  const service = container.resolve('formsSubmissionService') as SubmissionService

  try {
    const view = await service.start({
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      formKey: parsed.data.form_key,
      subjectType: parsed.data.subject_type,
      subjectId: parsed.data.subject_id,
      startedBy: auth.sub,
    })
    return NextResponse.json(
      {
        submission: serializeSubmission(view.submission),
        revision: serializeRevision(view.revision),
        decoded_data: view.decodedData,
        actors: view.actors.map(serializeActor),
      },
      { status: 201 },
    )
  } catch (error) {
    return mapSubmissionError(error)
  }
}

const errorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  details: z.unknown().optional(),
})

const submissionResponseSchema = z.object({
  submission: z.record(z.string(), z.unknown()),
  revision: z.record(z.string(), z.unknown()),
  decoded_data: z.record(z.string(), z.unknown()),
  actors: z.array(z.record(z.string(), z.unknown())),
})

const postMethodDoc: OpenApiMethodDoc = {
  summary: 'Start a new form submission',
  description: 'Starts a submission for the active version of a form, auto-assigning the starter to the default actor role.',
  tags: ['Forms Runtime'],
  requestBody: { schema: submissionStartInputSchema },
  responses: [{ status: 201, description: 'Submission started', schema: submissionResponseSchema }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 404, description: 'Form not found', schema: errorSchema },
    { status: 422, description: 'Validation or form-state error', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Form submission lifecycle',
  methods: { POST: postMethodDoc },
}
