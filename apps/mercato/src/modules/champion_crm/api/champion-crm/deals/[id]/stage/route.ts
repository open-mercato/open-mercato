import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { advanceDealStage } from '../../../../../lib/demo-flow'
import { championDealStageSchema } from '../../../../../data/validators'
import { championCrmOkSchema } from '../../../../openapi'
import { runChampionCrmActionRoute, type ChampionCrmActionRouteContext } from '../../../action-route'

const stageSchema = z.object({
  stage: championDealStageSchema,
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['champion_crm.deals.manage'] },
}

export async function POST(req: Request, context: ChampionCrmActionRouteContext) {
  const { id } = await context.params
  return runChampionCrmActionRoute(req, id, stageSchema, 'advance_deal_stage', async (input, ctx) => {
    const deal = await advanceDealStage(ctx.em, id, input.stage, ctx)
    return { dealId: deal.id, stage: deal.stage, status: deal.status }
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Champion CRM',
  summary: 'Advance Champion CRM deal stage',
  methods: {
    POST: {
      summary: 'Advance deal stage',
      requestBody: { contentType: 'application/json', schema: stageSchema },
      responses: [{ status: 200, description: 'Deal stage changed', schema: championCrmOkSchema.passthrough() }],
    },
  },
}
