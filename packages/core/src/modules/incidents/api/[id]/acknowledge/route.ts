import { acknowledgeSchema } from '../../../data/action-validators'
import { createIncidentActionOpenApi, handleIncidentActionPost } from '../action-route'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['incidents.incident.manage'] },
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handleIncidentActionPost(req, params, {
    commandId: 'incidents.incident.acknowledge',
    schema: acknowledgeSchema,
  })
}

export const openApi = createIncidentActionOpenApi({
  summary: 'Acknowledge incident',
  description: 'Marks an incident as acknowledged and appends an internal timeline entry.',
  requestSchema: acknowledgeSchema,
})
