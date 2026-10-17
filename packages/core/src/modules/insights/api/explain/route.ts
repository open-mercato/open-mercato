import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  explainErrorSchema,
  explainFieldResponseSchema,
  explainOverviewResponseSchema,
  explainQuerySchema,
} from '../../data/validators'
import { getExplainResource } from '../../lib/explain-registry'
import { EXPLAIN_VIEW_FEATURE } from '../../lib/viewer'
import { explainInternalError, explainJson, prepareExplainRequest } from '../../lib/routeHelpers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['insights.explain.view'] },
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const parsed = explainQuerySchema.safeParse(Object.fromEntries(url.searchParams))
    if (!parsed.success) return explainJson({ error: 'invalid_query', details: parsed.error.issues }, 400)
    const resource = getExplainResource(parsed.data.resourceKind)
    const prepared = await prepareExplainRequest(req, [
      EXPLAIN_VIEW_FEATURE,
      ...(resource?.descriptor.requiredFeatures ?? []),
    ])
    if (prepared instanceof NextResponse) return prepared
    const outcome = await prepared.service.explain(prepared.viewer, parsed.data)
    if (!outcome.ok) return explainJson(outcome.body, outcome.status)
    return explainJson(outcome.body)
  } catch (error) {
    return explainInternalError(error, 'explain')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Insights',
  summary: 'Explain a record value',
  description: 'Explains why a declared field of a record holds its current value, as a causal chain built from audit history with an honest confidence level.',
  methods: {
    GET: {
      summary: 'Explain a field or get a record overview',
      description:
        'With `field`, returns the causal chain, verdict and confidence for that field. Without `field`, returns an overview of every explainable field of the record. Unknown resource kinds, invisible records and out-of-scope records return an identical 404 body. Past values and actor identities are redacted unless the caller may read them through audit logs.',
      query: explainQuerySchema,
      responses: [
        {
          status: 200,
          description: 'Field explanation (with `field`) or record overview (without `field`)',
          schema: z.union([explainFieldResponseSchema, explainOverviewResponseSchema]),
        },
      ],
      errors: [
        { status: 400, description: 'Invalid query, unknown field, or a collection field without `itemId`', schema: explainErrorSchema },
        { status: 401, description: 'Authentication required', schema: explainErrorSchema },
        { status: 403, description: 'The caller has no resolved tenant', schema: explainErrorSchema },
        { status: 404, description: 'Record not found or not visible (`{ "error": "not_found" }`)', schema: explainErrorSchema },
      ],
    },
  },
}
