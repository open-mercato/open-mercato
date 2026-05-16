import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { assignApartmentToDeal } from '../../../../../lib/demo-flow'
import { championCrmOkSchema } from '../../../../openapi'
import { runChampionCrmActionRoute, type ChampionCrmActionRouteContext } from '../../../action-route'

const assignApartmentSchema = z.object({
  apartmentId: z.string().uuid(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['champion_crm.deals.manage'] },
}

export async function POST(req: Request, context: ChampionCrmActionRouteContext) {
  const { id } = await context.params
  return runChampionCrmActionRoute(req, id, assignApartmentSchema, 'assign_apartment_to_deal', async (input, ctx) => {
    const { deal, apartment } = await assignApartmentToDeal(ctx.em, id, input.apartmentId, ctx)
    return { dealId: deal.id, apartmentId: apartment.id, status: deal.status, apartmentStatus: apartment.status }
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Champion CRM',
  summary: 'Assign and reserve Champion CRM apartment',
  methods: {
    POST: {
      summary: 'Assign apartment to deal',
      requestBody: { contentType: 'application/json', schema: assignApartmentSchema },
      responses: [{ status: 200, description: 'Apartment assigned', schema: championCrmOkSchema.passthrough() }],
    },
  },
}
