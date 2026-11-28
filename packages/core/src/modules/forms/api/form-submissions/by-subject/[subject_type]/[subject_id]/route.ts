/**
 * Runtime API — GET /api/form-submissions/by-subject/:subject_type/:subject_id
 *
 * Lists submissions for a given subject visible to the calling user. The
 * caller must have an active actor row on each returned submission;
 * submissions where they have no actor row are filtered out. Customer auth
 * required.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { SubmissionService } from '../../../../../services/submission-service'
import { FormSubmissionActor } from '../../../../../data/entities'
import { submissionsBySubjectQuerySchema } from '../../../../../data/validators'
import { mapSubmissionError, serializeSubmission } from '../../../../runtime-helpers'

export const metadata = {
  GET: { requireAuth: false },
}

export async function GET(
  req: NextRequest,
  context: { params: { subject_type: string; subject_id: string } | Promise<{ subject_type: string; subject_id: string }> },
) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const params = await Promise.resolve(context.params)
  const subjectType = String(params.subject_type)
  const subjectId = String(params.subject_id)
  if (!subjectId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subjectId)) {
    return NextResponse.json({ error: 'VALIDATION_FAILED', message: 'subject_id must be a UUID.' }, { status: 422 })
  }
  const query = submissionsBySubjectQuerySchema.safeParse({
    resume_form_id: new URL(req.url).searchParams.get('resume_form_id') ?? undefined,
  })
  if (!query.success) return NextResponse.json({ error: 'VALIDATION_FAILED' }, { status: 422 })

  const container = await createRequestContainer()
  const service = container.resolve('formsSubmissionService') as SubmissionService
  const em = container.resolve('em') as EntityManager

  try {
    const submissions = await service.listSubmissionsBySubject({
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      subjectType,
      subjectId,
      resumeFormId: query.data.resume_form_id,
    })
    if (submissions.length === 0) return NextResponse.json({ items: [] })
    const submissionIds = submissions.map((entry) => entry.id)
    const actors = await em.find(
      FormSubmissionActor,
      {
        submissionId: { $in: submissionIds },
        organizationId: auth.orgId,
        userId: auth.sub,
        revokedAt: null,
        deletedAt: null,
      } as never,
    )
    const allowedSet = new Set(actors.map((entry: FormSubmissionActor) => entry.submissionId))
    const visible = submissions.filter((entry) => allowedSet.has(entry.id))
    return NextResponse.json({ items: visible.map(serializeSubmission) })
  } catch (error) {
    return mapSubmissionError(error)
  }
}

const errorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
})

const responseSchema = z.object({
  items: z.array(z.record(z.string(), z.unknown())),
})

const getMethodDoc: OpenApiMethodDoc = {
  summary: 'List submissions for a subject',
  description: 'Returns submissions accessible to the caller for the supplied subject. With resume_form_id, returns only drafts with saved progress and reopened submissions for that form, most recently updated first.',
  tags: ['Forms Runtime'],
  query: submissionsBySubjectQuerySchema,
  responses: [{ status: 200, description: 'Submission list', schema: responseSchema }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 422, description: 'Bad subject or form identifier', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'List submissions by subject',
  methods: { GET: getMethodDoc },
}
