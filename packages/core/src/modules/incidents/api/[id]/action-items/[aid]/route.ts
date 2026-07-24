import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  actionItemCommandResponseSchema,
  actionItemErrorResponseSchema,
  actionItemPathParamsSchema,
  actionItemRouteSchemas,
  handleActionItemCommand,
} from '../route'

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['incidents.incident.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['incidents.incident.manage'] },
}

export async function PUT(req: Request, { params }: { params: { id: string; aid: string } }) {
  const parsed = actionItemPathParamsSchema.parse(params)
  return handleActionItemCommand(req, parsed, {
    commandId: 'incidents.action_item.update',
    schema: actionItemRouteSchemas.update,
    operation: 'update',
    includeActionItemId: false,
  })
}

export async function DELETE(req: Request, { params }: { params: { id: string; aid: string } }) {
  const parsed = actionItemPathParamsSchema.parse(params)
  return handleActionItemCommand(req, parsed, {
    commandId: 'incidents.action_item.delete',
    schema: actionItemRouteSchemas.remove,
    operation: 'update',
    includeActionItemId: false,
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Incidents',
  summary: 'Incident action item',
  pathParams: actionItemPathParamsSchema,
  methods: {
    PUT: {
      summary: 'Update action item',
      description: 'Updates an incident action item and bumps the parent incident aggregate version.',
      requestBody: { contentType: 'application/json', schema: actionItemRouteSchemas.update },
      responses: [
        { status: 200, description: 'Action item updated', schema: actionItemCommandResponseSchema },
        { status: 400, description: 'Invalid payload', schema: actionItemErrorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: actionItemErrorResponseSchema },
        { status: 403, description: 'Forbidden', schema: actionItemErrorResponseSchema },
        { status: 404, description: 'Action item not found', schema: actionItemErrorResponseSchema },
        { status: 409, description: 'Conflict detected', schema: actionItemErrorResponseSchema },
        { status: 423, description: 'Record locked', schema: actionItemErrorResponseSchema },
      ],
    },
    DELETE: {
      summary: 'Delete action item',
      description: 'Soft-deletes an incident action item and bumps the parent incident aggregate version.',
      requestBody: { contentType: 'application/json', schema: actionItemRouteSchemas.remove },
      responses: [
        { status: 200, description: 'Action item deleted', schema: actionItemCommandResponseSchema },
        { status: 400, description: 'Invalid payload', schema: actionItemErrorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: actionItemErrorResponseSchema },
        { status: 403, description: 'Forbidden', schema: actionItemErrorResponseSchema },
        { status: 404, description: 'Action item not found', schema: actionItemErrorResponseSchema },
        { status: 409, description: 'Conflict detected', schema: actionItemErrorResponseSchema },
        { status: 423, description: 'Record locked', schema: actionItemErrorResponseSchema },
      ],
    },
  },
}
