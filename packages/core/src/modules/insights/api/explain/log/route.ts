import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { explainErrorSchema, explainLogQuerySchema, explainLogResponseSchema } from '../../../data/validators'
import { EXPLAIN_VIEW_FEATURE } from '../../../lib/viewer'
import { explainInternalError, explainJson, prepareExplainRequest } from '../../../lib/routeHelpers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['insights.explain.view'] },
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const parsed = explainLogQuerySchema.safeParse(Object.fromEntries(url.searchParams))
    if (!parsed.success) return explainJson({ error: 'invalid_query', details: parsed.error.issues }, 400)
    const prepared = await prepareExplainRequest(req, [EXPLAIN_VIEW_FEATURE])
    if (prepared instanceof NextResponse) return prepared
    const outcome = await prepared.service.explainLog(prepared.viewer, parsed.data.logId, { rescope: prepared.rescope })
    if (!outcome.ok) return explainJson(outcome.body, outcome.status)
    return explainJson(outcome.body)
  } catch (error) {
    return explainInternalError(error, 'log')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Insights',
  summary: 'Explain an audit entry',
  description: 'Explains the recorded cause of one audit log entry.',
  methods: {
    GET: {
      summary: 'Explain the cause of an audit entry',
      description:
        'Returns the cause, origin and confidence of one audit entry. Audit read rules apply: without `audit_logs.view_tenant` only the caller\'s own entries are visible. When the entry belongs to an explainable resource, the caller must also be able to read that record. Entries outside the caller\'s tenant or organization scope return an identical 404 body.',
      query: explainLogQuerySchema,
      responses: [
        { status: 200, description: 'Audit entry explanation', schema: explainLogResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid log id', schema: explainErrorSchema },
        { status: 401, description: 'Authentication required', schema: explainErrorSchema },
        { status: 403, description: 'The caller has no resolved tenant', schema: explainErrorSchema },
        { status: 404, description: 'Entry not found or not visible (`{ "error": "not_found" }`)', schema: explainErrorSchema },
      ],
    },
  },
}
