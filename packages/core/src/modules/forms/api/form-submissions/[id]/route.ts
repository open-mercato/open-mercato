/**
 * Runtime API — GET/PATCH /api/form-submissions/:id
 *
 * GET returns the role-sliced current state for the calling user.
 * PATCH appends a revision (autosave) — body shape `{ base_revision_id, patch }`.
 *
 * Customer auth required. Cross-tenant attempts return 404 (the underlying
 * service filters by organizationId+tenantId).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { SubmissionService } from '../../../services/submission-service'
import { FormSubmissionActor } from '../../../data/entities'
import { submissionSaveInputSchema } from '../../../data/validators'
import { mapSubmissionError, readJsonBody, serializeActor, serializeRevision, serializeSubmission } from '../../runtime-helpers'

export const metadata = {
  GET: { requireAuth: false },
  PATCH: { requireAuth: false },
}

export async function GET(
  req: NextRequest,
  context: { params: { id: string } | Promise<{ id: string }> },
) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const params = await Promise.resolve(context.params)
  const submissionId = String(params.id)

  const container = await createRequestContainer()
  const service = container.resolve('formsSubmissionService') as SubmissionService
  const em = container.resolve('em') as EntityManager

  try {
    const role = await resolveActiveRole(em, {
      submissionId,
      organizationId: auth.orgId,
      userId: auth.sub,
    })
    const view = await service.getCurrent({
      submissionId,
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      viewerRole: role,
      viewerUserId: auth.sub,
    })
    return NextResponse.json({
      submission: serializeSubmission(view.submission),
      revision: serializeRevision(view.revision),
      decoded_data: view.decodedData,
      actors: view.actors.map(serializeActor),
    })
  } catch (error) {
    return mapSubmissionError(error)
  }
}

export async function PATCH(
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
  const parsed = submissionSaveInputSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_FAILED', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const container = await createRequestContainer()
  const service = container.resolve('formsSubmissionService') as SubmissionService

  try {
    const outcome = await service.save({
      submissionId,
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      baseRevisionId: parsed.data.base_revision_id,
      patch: parsed.data.patch,
      changeSummary: parsed.data.change_summary ?? null,
      savedBy: auth.sub,
      changeSource: 'user',
    })
    return NextResponse.json({
      revision: serializeRevision(outcome.revision),
      coalesced: outcome.coalesced,
    })
  } catch (error) {
    return mapSubmissionError(error)
  }
}

async function resolveActiveRole(
  em: EntityManager,
  args: { submissionId: string; organizationId: string; userId: string },
): Promise<string | null> {
  const actor = await em.findOne(FormSubmissionActor, {
    submissionId: args.submissionId,
    organizationId: args.organizationId,
    userId: args.userId,
    revokedAt: null,
    deletedAt: null,
  })
  return actor?.role ?? null
}

const errorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  details: z.unknown().optional(),
})

const getResponseSchema = z.object({
  submission: z.record(z.string(), z.unknown()),
  revision: z.record(z.string(), z.unknown()),
  decoded_data: z.record(z.string(), z.unknown()),
  actors: z.array(z.record(z.string(), z.unknown())),
})

const patchResponseSchema = z.object({
  revision: z.record(z.string(), z.unknown()),
  coalesced: z.boolean(),
})

const getMethodDoc: OpenApiMethodDoc = {
  summary: 'Get current submission state (role-sliced)',
  description: 'Returns the current revision payload sliced to the calling user\'s active actor role.',
  tags: ['Forms Runtime'],
  responses: [{ status: 200, description: 'Submission state', schema: getResponseSchema }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 404, description: 'Submission not found', schema: errorSchema },
  ],
}

const patchMethodDoc: OpenApiMethodDoc = {
  summary: 'Save (autosave) a submission revision',
  description: 'Appends a revision when the supplied base_revision_id matches; rate-limited to FORMS_AUTOSAVE_INTERVAL_MS / 2.',
  tags: ['Forms Runtime'],
  requestBody: { schema: submissionSaveInputSchema },
  responses: [{ status: 200, description: 'Revision saved', schema: patchResponseSchema }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'No active actor row for user', schema: errorSchema },
    { status: 404, description: 'Submission not found', schema: errorSchema },
    { status: 409, description: 'Stale base_revision_id', schema: errorSchema },
    { status: 422, description: 'Validation failed', schema: errorSchema },
    { status: 429, description: 'Save rate limit exceeded', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Form submission state and autosave',
  methods: { GET: getMethodDoc, PATCH: patchMethodDoc },
}
