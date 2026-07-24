import { snoozeSchema } from '../../../data/action-validators'
import { createIncidentActionOpenApi, handleIncidentActionPost } from '../action-route'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['incidents.incident.manage'] },
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handleIncidentActionPost(req, params, {
    commandId: 'incidents.incident.snooze',
    schema: snoozeSchema,
  })
}

export const openApi = createIncidentActionOpenApi({
  summary: 'Snooze incident',
  description: 'Sets the incident snooze deadline and appends an internal system timeline entry.',
  requestSchema: snoozeSchema,
})
