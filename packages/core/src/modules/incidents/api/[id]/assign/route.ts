import { assignSchema } from '../../../data/action-validators'
import { createIncidentActionOpenApi, handleIncidentActionPost } from '../action-route'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['incidents.incident.assign'] },
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handleIncidentActionPost(req, params, {
    commandId: 'incidents.incident.assign',
    schema: assignSchema,
  })
}

export const openApi = createIncidentActionOpenApi({
  summary: 'Assign incident',
  description: 'Changes the incident owner and/or owning team and records the assignment in the internal timeline.',
  requestSchema: assignSchema,
})
