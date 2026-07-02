import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  handlePostmortemCommand,
  postmortemCommandResponseSchema,
  postmortemErrorResponseSchema,
  postmortemPathParamsSchema,
  postmortemRouteSchemas,
} from '../route'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['incidents.postmortem.manage'] },
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handlePostmortemCommand(req, params, {
    commandId: 'incidents.postmortem.publish',
    schema: postmortemRouteSchemas.publish,
    includePostmortemId: false,
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Incidents',
  summary: 'Publish incident postmortem',
  pathParams: postmortemPathParamsSchema,
  methods: {
    POST: {
      summary: 'Publish postmortem',
      description: 'Publishes a draft incident postmortem and bumps the parent incident aggregate version.',
      requestBody: {
        contentType: 'application/json',
        schema: postmortemRouteSchemas.publish,
      },
      responses: [
        { status: 200, description: 'Postmortem published', schema: postmortemCommandResponseSchema },
        { status: 400, description: 'Invalid payload', schema: postmortemErrorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: postmortemErrorResponseSchema },
        { status: 403, description: 'Forbidden', schema: postmortemErrorResponseSchema },
        { status: 409, description: 'Conflict detected', schema: postmortemErrorResponseSchema },
        { status: 423, description: 'Record locked', schema: postmortemErrorResponseSchema },
      ],
    },
  },
}
