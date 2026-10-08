import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { explainDescriptorsResponseSchema, explainErrorSchema } from '../../../data/validators'
import { EXPLAIN_VIEW_FEATURE } from '../../../lib/viewer'
import { explainInternalError, explainJson, prepareExplainRequest } from '../../../lib/routeHelpers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['insights.explain.view'] },
}

export async function GET(req: Request) {
  try {
    const prepared = await prepareExplainRequest(req, [EXPLAIN_VIEW_FEATURE])
    if (prepared instanceof NextResponse) return prepared
    return explainJson(await prepared.service.describe(prepared.viewer))
  } catch (error) {
    return explainInternalError(error, 'descriptors')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Insights',
  summary: 'List explainable resources',
  description: 'Lists the resources, fields, collections and custom fields the caller may explain.',
  methods: {
    GET: {
      summary: 'List explain descriptors',
      description: 'Returns the explain declarations registered by enabled modules, filtered by the caller\'s features (wildcard-aware). Fields, collections and custom fields the caller cannot read are omitted.',
      responses: [
        { status: 200, description: 'Explainable resources', schema: explainDescriptorsResponseSchema },
      ],
      errors: [
        { status: 401, description: 'Authentication required', schema: explainErrorSchema },
        { status: 403, description: 'The caller has no resolved tenant', schema: explainErrorSchema },
      ],
    },
  },
}
