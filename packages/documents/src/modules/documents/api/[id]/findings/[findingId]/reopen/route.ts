import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findingReopenSchema } from '../../../../../data/validators'
import {
  buildFindingDecisionOpenApi,
  handleFindingDecision,
  type FindingRouteParams,
} from '../../../../_findings'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['documents.edit'] },
}

export async function POST(request: Request, context: FindingRouteParams): Promise<Response> {
  return handleFindingDecision('reopen', request, context, findingReopenSchema, () => ({}))
}

export const openApi: OpenApiRouteDoc = buildFindingDecisionOpenApi(
  'Reopen a decided finding',
  findingReopenSchema,
)

export default { POST }
