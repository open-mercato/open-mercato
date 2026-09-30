/**
 * Public runtime API — GET / PATCH /api/forms/public/submissions/:id
 *
 * GET resumes a submission (role-sliced current state); PATCH autosaves a
 * revision. Both authorize via `resolveRuntimePrincipal`, which accepts EITHER
 * a submission access token (`Authorization: Bearer …`) OR a portal customer
 * session. The org/tenant are ALWAYS re-derived from the persisted submission
 * (R-2d-4) — never trusted from the client.
 *
 * On a token-authorized save the access token is re-issued with a slid TTL.
 * Customer-authorized requests omit `access_token` (the session is the bearer).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { SubmissionService } from '../../../../services/submission-service'
import type { DistributionService } from '../../../../services/distribution-service'
import { submissionSaveInputSchema } from '../../../../data/validators'
import { resolveRuntimePrincipal } from '../../../../lib/runtime-principal'
import {
  mapSubmissionError,
  readJsonBody,
  serializeActor,
  serializeRevision,
  serializeSubmission,
} from '../../../runtime-helpers'
import { enforcePublicRateLimit, getClientIp } from '../../rate-limit'

export const metadata = {
  GET: { requireAuth: false },
  PATCH: { requireAuth: false },
}

export async function GET(
  req: NextRequest,
  context: { params: { id: string } | Promise<{ id: string }> },
) {
  const params = await Promise.resolve(context.params)
  const submissionId = String(params.id)

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const service = container.resolve('formsSubmissionService') as SubmissionService

  const principal = await resolveRuntimePrincipal({ req, submissionId, em })
  if (!principal) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  try {
    const view = await service.getCurrent({
      organizationId: principal.organizationId,
      tenantId: principal.tenantId,
      submissionId,
      viewerRole: principal.role,
      viewerUserId: principal.source === 'customer' ? principal.principal : null,
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
  const params = await Promise.resolve(context.params)
  const submissionId = String(params.id)

  const limited = await enforcePublicRateLimit(`forms:public:save:${submissionId}:${getClientIp(req)}`)
  if (limited) return limited

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
  const em = container.resolve('em') as EntityManager
  const service = container.resolve('formsSubmissionService') as SubmissionService

  const principal = await resolveRuntimePrincipal({ req, submissionId, em })
  if (!principal) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  try {
    const outcome = await service.save({
      organizationId: principal.organizationId,
      tenantId: principal.tenantId,
      submissionId,
      baseRevisionId: parsed.data.base_revision_id,
      patch: parsed.data.patch,
      changeSummary: parsed.data.change_summary ?? null,
      savedBy: principal.principal,
      changeSource: 'user',
    })

    const body: { revision: ReturnType<typeof serializeRevision>; access_token?: string } = {
      revision: serializeRevision(outcome.revision),
    }
    if (principal.source === 'token') {
      const distributionService = container.resolve('formsDistributionService') as DistributionService
      body.access_token = distributionService.refreshAccessToken(
        submissionId,
        principal.principal,
        principal.role,
      )
    }
    return NextResponse.json(body)
  } catch (error) {
    return mapSubmissionError(error)
  }
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
  access_token: z.string().optional(),
})

const getMethodDoc: OpenApiMethodDoc = {
  summary: 'Resume a public submission',
  description: 'Returns the role-sliced current state for the submission named in the access token (or customer session).',
  tags: ['Forms Public Runtime'],
  responses: [{ status: 200, description: 'Submission state', schema: getResponseSchema }],
  errors: [
    { status: 401, description: 'Missing or invalid access token / session', schema: errorSchema },
    { status: 404, description: 'Submission not found', schema: errorSchema },
  ],
}

const patchMethodDoc: OpenApiMethodDoc = {
  summary: 'Autosave a public submission',
  description: 'Appends a revision when base_revision_id matches; re-issues the access token (token-authorized requests) with a slid TTL.',
  tags: ['Forms Public Runtime'],
  requestBody: { schema: submissionSaveInputSchema },
  responses: [{ status: 200, description: 'Revision saved', schema: patchResponseSchema }],
  errors: [
    { status: 401, description: 'Missing or invalid access token / session', schema: errorSchema },
    { status: 404, description: 'Submission not found', schema: errorSchema },
    { status: 409, description: 'Stale base_revision_id', schema: errorSchema },
    { status: 422, description: 'Validation failed', schema: errorSchema },
    { status: 429, description: 'Rate limit exceeded', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Public submission state and autosave',
  methods: { GET: getMethodDoc, PATCH: patchMethodDoc },
}
