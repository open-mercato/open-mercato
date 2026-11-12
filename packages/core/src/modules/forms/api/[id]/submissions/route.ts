/**
 * Admin API — GET /api/forms/:id/submissions
 *
 * Paginated submissions inbox for a given form. Phase 2a's UI hangs off this
 * route. Staff auth + `forms.view` feature required; the page itself
 * resolves auth via `metadata.requireFeatures`.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { SubmissionService } from '../../../services/submission-service'
import { mapSubmissionError, serializeSubmission } from '../../runtime-helpers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['forms.view'] },
}

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['draft', 'submitted', 'reopened', 'archived']).optional(),
})

export async function GET(
  req: NextRequest,
  context: { params: { id: string } | Promise<{ id: string }> },
) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!auth.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Tenant scope required' }, { status: 403 })
  }
  const params = await Promise.resolve(context.params)
  const formId = String(params.id)

  const url = new URL(req.url)
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_FAILED', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const container = await createRequestContainer()
  const service = container.resolve('formsSubmissionService') as SubmissionService

  try {
    const result = await service.listSubmissionsByForm({
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      formId,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      status: parsed.data.status,
    })
    return NextResponse.json({
      items: result.items.map(serializeSubmission),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    })
  } catch (error) {
    return mapSubmissionError(error)
  }
}

const errorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  details: z.unknown().optional(),
})

const responseSchema = z.object({
  items: z.array(z.record(z.string(), z.unknown())),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
})

const getMethodDoc: OpenApiMethodDoc = {
  summary: 'List submissions for a form (admin inbox)',
  description: 'Paginated submission listing scoped to the form id.',
  tags: ['Forms Admin'],
  responses: [{ status: 200, description: 'Submission list', schema: responseSchema }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 422, description: 'Bad query parameters', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Form submissions inbox',
  methods: { GET: getMethodDoc },
}
