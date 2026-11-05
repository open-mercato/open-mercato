/**
 * Admin API — GET /api/forms/:id/analytics
 *
 * Aggregate, PII-safe analytics for a form's submissions across every version.
 * Staff auth + `forms.view` feature required. The response carries COUNTS ONLY
 * — never raw answer text/values. Sensitive (`x-om-sensitive`) and free-text /
 * non-enumerable fields are excluded from value distributions by the service.
 *
 * Tenant isolation: every query is scoped by `organizationId` + `tenantId`.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  AnalyticsService,
  MAX_ANALYTICS_SCAN_LIMIT,
} from '../../../services/analytics-service'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['forms.view'] },
}

const querySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_ANALYTICS_SCAN_LIMIT).optional(),
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
  const service = container.resolve('formsAnalyticsService') as AnalyticsService

  try {
    const analytics = await service.computeFormAnalytics({
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      formId,
      from: parsed.data.from ?? null,
      to: parsed.data.to ?? null,
      limit: parsed.data.limit ?? null,
    })
    return NextResponse.json(analytics)
  } catch {
    return NextResponse.json({ error: 'INTERNAL', message: 'Failed to compute analytics.' }, { status: 500 })
  }
}

const errorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  details: z.unknown().optional(),
})

const fieldStatsSchema = z.object({
  fieldKey: z.string(),
  type: z.string(),
  sensitive: z.boolean(),
  answered: z.number().int().nonnegative(),
  blank: z.number().int().nonnegative(),
  choices: z
    .array(z.object({ value: z.string(), count: z.number().int().nonnegative() }))
    .optional(),
})

const responseSchema = z.object({
  formId: z.string(),
  window: z.object({ from: z.string().nullable(), to: z.string().nullable() }),
  scan: z.object({
    limit: z.number().int().positive(),
    scanned: z.number().int().nonnegative(),
    capped: z.boolean(),
  }),
  funnel: z.object({
    started: z.number().int().nonnegative(),
    submitted: z.number().int().nonnegative(),
    completionRate: z.number(),
    byStatus: z.record(z.string(), z.number().int().nonnegative()),
  }),
  volume: z.array(
    z.object({
      date: z.string(),
      started: z.number().int().nonnegative(),
      submitted: z.number().int().nonnegative(),
    }),
  ),
  timeToComplete: z.object({
    sampleSize: z.number().int().nonnegative(),
    medianSeconds: z.number().nullable(),
    averageSeconds: z.number().nullable(),
  }),
  fields: z.array(fieldStatsSchema),
  dropOff: z.array(z.object({ sectionKey: z.string(), count: z.number().int().nonnegative() })),
})

const getMethodDoc: OpenApiMethodDoc = {
  summary: 'Aggregate analytics for a form',
  description:
    'Tenant-scoped, PII-safe aggregate analytics across all versions of a form: funnel/completion, daily volume, time-to-complete, per-field response counts (value distributions only for non-sensitive enumerable types), and best-effort draft drop-off. Counts only — never raw answer values.',
  tags: ['Forms Admin'],
  responses: [{ status: 200, description: 'Aggregate analytics', schema: responseSchema }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'Tenant scope required', schema: errorSchema },
    { status: 422, description: 'Bad query parameters', schema: errorSchema },
    { status: 500, description: 'Computation failed', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Form analytics',
  methods: { GET: getMethodDoc },
}
