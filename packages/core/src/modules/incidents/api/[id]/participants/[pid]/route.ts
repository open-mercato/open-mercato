import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  handleParticipantCommand,
  participantCommandResponseSchema,
  participantErrorResponseSchema,
  participantPathParamsSchema,
  participantRouteSchemas,
} from '../route'

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['incidents.incident.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['incidents.incident.manage'] },
}

export async function PUT(req: Request, { params }: { params: { id: string; pid: string } }) {
  const parsed = participantPathParamsSchema.parse(params)
  return handleParticipantCommand(req, parsed, {
    commandId: 'incidents.participant.update_role',
    schema: participantRouteSchemas.update,
    operation: 'update',
  })
}

export async function DELETE(req: Request, { params }: { params: { id: string; pid: string } }) {
  const parsed = participantPathParamsSchema.parse(params)
  return handleParticipantCommand(req, parsed, {
    commandId: 'incidents.participant.remove',
    schema: participantRouteSchemas.remove,
    operation: 'update',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Incidents',
  summary: 'Incident participant',
  pathParams: participantPathParamsSchema,
  methods: {
    PUT: {
      summary: 'Update participant role',
      description: 'Updates a participant role and bumps the parent incident aggregate version.',
      requestBody: {
        contentType: 'application/json',
        schema: participantRouteSchemas.update,
      },
      responses: [
        { status: 200, description: 'Participant role updated', schema: participantCommandResponseSchema },
        { status: 400, description: 'Invalid payload', schema: participantErrorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: participantErrorResponseSchema },
        { status: 403, description: 'Forbidden', schema: participantErrorResponseSchema },
        { status: 404, description: 'Participant not found', schema: participantErrorResponseSchema },
        { status: 409, description: 'Conflict detected', schema: participantErrorResponseSchema },
        { status: 423, description: 'Record locked', schema: participantErrorResponseSchema },
      ],
    },
    DELETE: {
      summary: 'Remove participant',
      description: 'Soft-deletes a participant and bumps the parent incident aggregate version.',
      requestBody: {
        contentType: 'application/json',
        schema: participantRouteSchemas.remove,
      },
      responses: [
        { status: 200, description: 'Participant removed', schema: participantCommandResponseSchema },
        { status: 400, description: 'Invalid payload', schema: participantErrorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: participantErrorResponseSchema },
        { status: 403, description: 'Forbidden', schema: participantErrorResponseSchema },
        { status: 404, description: 'Participant not found', schema: participantErrorResponseSchema },
        { status: 409, description: 'Conflict detected', schema: participantErrorResponseSchema },
        { status: 423, description: 'Record locked', schema: participantErrorResponseSchema },
      ],
    },
  },
}
