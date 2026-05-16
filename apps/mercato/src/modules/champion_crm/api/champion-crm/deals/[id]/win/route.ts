import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { markDealWon } from '../../../../../lib/demo-flow'
import { championCrmOkSchema } from '../../../../openapi'
import { runChampionCrmActionRoute, type ChampionCrmActionRouteContext } from '../../../action-route'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['champion_crm.deals.manage'] },
}

export async function POST(req: Request, context: ChampionCrmActionRouteContext) {
  const { id } = await context.params
  return runChampionCrmActionRoute(req, id, z.object({}).passthrough(), 'mark_deal_won', async (_input, ctx) => {
    const deal = await markDealWon(ctx.em, id, ctx)
    return { dealId: deal.id, stage: deal.stage, status: deal.status, wonAt: deal.wonAt?.toISOString() ?? null }
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Champion CRM',
  summary: 'Mark Champion CRM deal won',
  methods: {
    POST: {
      summary: 'Mark deal won',
      responses: [{ status: 200, description: 'Deal won', schema: championCrmOkSchema.passthrough() }],
    },
  },
}
