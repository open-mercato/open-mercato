import { changeSeveritySchema } from '../../../data/action-validators'
import { createIncidentActionOpenApi, handleIncidentActionPost } from '../action-route'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['incidents.incident.manage'] },
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handleIncidentActionPost(req, params, {
    commandId: 'incidents.incident.change_severity',
    schema: changeSeveritySchema,
  })
}

export const openApi = createIncidentActionOpenApi({
  summary: 'Change incident severity',
  description: 'Changes an incident severity after verifying the target severity belongs to the same tenant and organization.',
  requestSchema: changeSeveritySchema,
})
