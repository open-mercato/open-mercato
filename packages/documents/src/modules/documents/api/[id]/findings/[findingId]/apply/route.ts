import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findingApplySchema } from '../../../../../data/validators'
import {
  buildFindingDecisionOpenApi,
  handleFindingDecision,
  type FindingRouteParams,
} from '../../../../_findings'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['documents.edit'] },
}

export async function POST(request: Request, context: FindingRouteParams): Promise<Response> {
  return handleFindingDecision('apply', request, context, findingApplySchema, (body) => ({
    appliedText: body.appliedText,
  }))
}

export const openApi: OpenApiRouteDoc = buildFindingDecisionOpenApi(
  'Record that a finding suggestion was applied',
  findingApplySchema,
  [{ status: 422, description: 'Finding has no suggested text or its passage was not located' }],
)

export default { POST }
