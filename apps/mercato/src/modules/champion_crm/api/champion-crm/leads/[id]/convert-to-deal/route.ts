import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createDealFromLead } from '../../../../../lib/demo-flow'
import { championCrmOkSchema } from '../../../../openapi'
import { runChampionCrmActionRoute, type ChampionCrmActionRouteContext } from '../../../action-route'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['champion_crm.deals.manage'] },
}

export async function POST(req: Request, context: ChampionCrmActionRouteContext) {
  const { id } = await context.params
  return runChampionCrmActionRoute(req, id, z.object({}).passthrough(), 'create_deal_from_lead', async (_input, ctx) => {
    const deal = await createDealFromLead(ctx.em, id, ctx)
    return { dealId: deal.id, contactId: deal.contactId, dealNumber: deal.dealNumber ?? null }
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Champion CRM',
  summary: 'Create or open Champion CRM deal from lead',
  methods: {
    POST: {
      summary: 'Create or open deal from lead',
      responses: [{ status: 200, description: 'Deal ready', schema: championCrmOkSchema.passthrough() }],
    },
  },
}
