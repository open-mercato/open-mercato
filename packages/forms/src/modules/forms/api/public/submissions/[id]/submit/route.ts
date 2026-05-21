/**
 * Public runtime API — POST /api/forms/public/submissions/:id/submit
 *
 * Finalizes an anonymous (token) or customer-session submission.
 *
 * For token-authorized submits the order is load-bearing for atomic cap
 * enforcement (R-2d-5): FIRST reserve a response slot on the distribution
 * (derived from the invitation), and only if that succeeds proceed to submit,
 * then mark the invitation submitted. A capped distribution returns 410 BEFORE
 * any submission state changes. Customer-session submits skip the
 * reserve/mark-invitation steps — those are anonymous-distribution concerns.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { SubmissionService } from '../../../../../services/submission-service'
import type { DistributionService } from '../../../../../services/distribution-service'
import { FormDistribution, FormInvitation } from '../../../../../data/entities'
import { submissionSubmitInputSchema } from '../../../../../data/validators'
import { resolveRuntimePrincipal } from '../../../../../lib/runtime-principal'
import {
  mapDistributionError,
  readJsonBody,
  serializeSubmission,
} from '../../../../runtime-helpers'
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

  const limited = await enforcePublicRateLimit(`forms:public:submit:${submissionId}:${getClientIp(req)}`)
  if (limited) return limited

  let raw: unknown
  try {
    raw = await readJsonBody(req)
  } catch (error) {
    return mapDistributionError(error)
  }
  const parsed = submissionSubmitInputSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_FAILED', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const service = container.resolve('formsSubmissionService') as SubmissionService

  const principal = await resolveRuntimePrincipal({ req, submissionId, em })
  if (!principal) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  try {
    let distribution: FormDistribution | null = null

    if (principal.source === 'token') {
      const invitation = await em.findOne(FormInvitation, {
        id: principal.principal,
        organizationId: principal.organizationId,
        tenantId: principal.tenantId,
        deletedAt: null,
      })
      if (!invitation) {
        return NextResponse.json({ error: 'NOT_FOUND', message: 'Invitation not found.' }, { status: 404 })
      }
      distribution = await em.findOne(FormDistribution, {
        id: invitation.distributionId,
        organizationId: principal.organizationId,
        tenantId: principal.tenantId,
        deletedAt: null,
      })

      const distributionService = container.resolve('formsDistributionService') as DistributionService
      // Reserve BEFORE submitting — a capped distribution must 410 without
      // mutating the submission.
      await distributionService.reserveResponseSlot({
        distributionId: invitation.distributionId,
        organizationId: principal.organizationId,
        tenantId: principal.tenantId,
      })
    }

    const submission = await service.submit({
      organizationId: principal.organizationId,
      tenantId: principal.tenantId,
      submissionId,
      baseRevisionId: parsed.data.base_revision_id,
      submittedBy: principal.principal,
      submitMetadata: parsed.data.submit_metadata ?? null,
    })

    if (principal.source === 'token') {
      const distributionService = container.resolve('formsDistributionService') as DistributionService
      await distributionService.markInvitationSubmitted({
        invitationId: principal.principal,
        organizationId: principal.organizationId,
        tenantId: principal.tenantId,
        submissionId,
      })
    }

    return NextResponse.json({
      submission: serializeSubmission(submission),
      redirect_url: distribution?.redirectUrl ?? null,
    })
  } catch (error) {
    return mapDistributionError(error)
  }
}

const errorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  details: z.unknown().optional(),
})

const responseSchema = z.object({
  submission: z.record(z.string(), z.unknown()),
  redirect_url: z.string().nullable(),
})

const postMethodDoc: OpenApiMethodDoc = {
  summary: 'Submit a public submission',
  description: 'Finalizes the submission named in the access token / session, enforcing the distribution response cap atomically before submitting.',
  tags: ['Forms Public Runtime'],
  requestBody: { schema: submissionSubmitInputSchema },
  responses: [{ status: 200, description: 'Submission submitted', schema: responseSchema }],
  errors: [
    { status: 401, description: 'Missing or invalid access token / session', schema: errorSchema },
    { status: 404, description: 'Submission or invitation not found', schema: errorSchema },
    { status: 409, description: 'Stale base_revision_id', schema: errorSchema },
    { status: 410, description: 'Distribution response cap reached or unavailable', schema: errorSchema },
    { status: 422, description: 'Validation failed or submission in terminal state', schema: errorSchema },
    { status: 429, description: 'Rate limit exceeded', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Submit a public submission',
  methods: { POST: postMethodDoc },
}
