import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  handleImpactCommand,
  impactCommandResponseSchema,
  impactErrorResponseSchema,
  impactRouteSchemas,
  incidentImpactItemPathParamsSchema,
} from '../route'

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['incidents.incident.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['incidents.incident.manage'] },
}

export async function PUT(req: Request, { params }: { params: { id: string; iid: string } }) {
  const parsed = incidentImpactItemPathParamsSchema.parse(params)
  return handleImpactCommand(req, parsed, {
    commandId: 'incidents.impact.update_status',
    schema: impactRouteSchemas.update,
    operation: 'update',
  })
}

export async function DELETE(req: Request, { params }: { params: { id: string; iid: string } }) {
  const parsed = incidentImpactItemPathParamsSchema.parse(params)
  return handleImpactCommand(req, parsed, {
    commandId: 'incidents.impact.remove',
    schema: impactRouteSchemas.remove,
    operation: 'update',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Incidents',
  summary: 'Incident impact',
  pathParams: incidentImpactItemPathParamsSchema,
  methods: {
    PUT: {
      summary: 'Update impact status',
      description: 'Updates impact status, snapshot, or revenue metrics and bumps the parent incident aggregate version.',
      requestBody: {
        contentType: 'application/json',
        schema: impactRouteSchemas.update,
      },
      responses: [
        { status: 200, description: 'Impact updated', schema: impactCommandResponseSchema },
        { status: 400, description: 'Invalid payload', schema: impactErrorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: impactErrorResponseSchema },
        { status: 403, description: 'Forbidden', schema: impactErrorResponseSchema },
        { status: 404, description: 'Impact not found', schema: impactErrorResponseSchema },
        { status: 409, description: 'Conflict detected', schema: impactErrorResponseSchema },
        { status: 423, description: 'Record locked', schema: impactErrorResponseSchema },
      ],
    },
    DELETE: {
      summary: 'Remove impact',
      description: 'Soft-deletes an impact, recomputes revenue at risk, and bumps the parent incident aggregate version.',
      requestBody: {
        contentType: 'application/json',
        schema: impactRouteSchemas.remove,
      },
      responses: [
        { status: 200, description: 'Impact removed', schema: impactCommandResponseSchema },
        { status: 400, description: 'Invalid payload', schema: impactErrorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: impactErrorResponseSchema },
        { status: 403, description: 'Forbidden', schema: impactErrorResponseSchema },
        { status: 404, description: 'Impact not found', schema: impactErrorResponseSchema },
        { status: 409, description: 'Conflict detected', schema: impactErrorResponseSchema },
        { status: 423, description: 'Record locked', schema: impactErrorResponseSchema },
      ],
    },
  },
}
