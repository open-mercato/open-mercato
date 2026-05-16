import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { qualifyLead } from '../../../../../lib/demo-flow'
import { championCrmOkSchema } from '../../../../openapi'
import { runChampionCrmActionRoute, type ChampionCrmActionRouteContext } from '../../../action-route'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['champion_crm.leads.manage'] },
}

export async function POST(req: Request, context: ChampionCrmActionRouteContext) {
  const { id } = await context.params
  return runChampionCrmActionRoute(req, id, z.object({}).passthrough(), 'qualify_lead', async (_input, ctx) => {
    const lead = await qualifyLead(ctx.em, id, ctx)
    return { leadId: lead.id, qualificationStatus: lead.qualificationStatus }
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Champion CRM',
  summary: 'Qualify Champion CRM lead',
  methods: {
    POST: {
      summary: 'Qualify a lead',
      responses: [{ status: 200, description: 'Lead qualified', schema: championCrmOkSchema.passthrough() }],
    },
  },
}
