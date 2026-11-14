import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findingKeepSchema } from '../../../../../data/validators'
import {
  buildFindingDecisionOpenApi,
  handleFindingDecision,
  type FindingRouteParams,
} from '../../../../_findings'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['documents.edit'] },
}

export async function POST(request: Request, context: FindingRouteParams): Promise<Response> {
  return handleFindingDecision('keep', request, context, findingKeepSchema, (body) => ({
    note: body.note ?? null,
  }))
}

export const openApi: OpenApiRouteDoc = buildFindingDecisionOpenApi(
  'Keep the original text for a finding',
  findingKeepSchema,
  [{ status: 422, description: 'A note is required for a blocking finding' }],
)

export default { POST }
