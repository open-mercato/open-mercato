import { transitionSchema } from '../../../data/action-validators'
import { createIncidentActionOpenApi, handleIncidentActionPost } from '../action-route'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['incidents.incident.manage'] },
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handleIncidentActionPost(req, params, {
    commandId: 'incidents.incident.transition_status',
    schema: transitionSchema,
  })
}

export const openApi = createIncidentActionOpenApi({
  summary: 'Transition incident status',
  description: 'Moves an incident through the lifecycle graph, validates required resolve fields, and writes a draft postmortem when resolving or closing.',
  requestSchema: transitionSchema,
})
