import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  handleLinkCommand,
  linkDeleteResponseSchema,
  linkErrorResponseSchema,
  linkPathParamsSchema,
  linkRouteSchemas,
} from '../route'

export const metadata = {
  DELETE: { requireAuth: true, requireFeatures: ['incidents.incident.manage'] },
}

export async function DELETE(req: Request, { params }: { params: { id: string; lid: string } }) {
  const parsed = linkPathParamsSchema.parse(params)
  return handleLinkCommand(req, parsed, {
    commandId: 'incidents.incident.unlink',
    schema: linkRouteSchemas.remove,
    operation: 'update',
    includeLinkId: false,
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Incidents',
  summary: 'Incident link',
  pathParams: linkPathParamsSchema,
  methods: {
    DELETE: {
      summary: 'Delete incident link',
      description: 'Soft-deletes an incident link and bumps the parent incident aggregate version.',
      requestBody: {
        contentType: 'application/json',
        schema: linkRouteSchemas.remove,
      },
      responses: [
        { status: 200, description: 'Incident link deleted', schema: linkDeleteResponseSchema },
        { status: 400, description: 'Invalid payload', schema: linkErrorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: linkErrorResponseSchema },
        { status: 403, description: 'Forbidden', schema: linkErrorResponseSchema },
        { status: 404, description: 'Incident link not found', schema: linkErrorResponseSchema },
        { status: 409, description: 'Conflict detected', schema: linkErrorResponseSchema },
        { status: 423, description: 'Record locked', schema: linkErrorResponseSchema },
      ],
    },
  },
}
