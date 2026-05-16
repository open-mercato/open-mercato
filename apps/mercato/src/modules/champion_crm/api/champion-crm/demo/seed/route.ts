import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { seedChampionCrmDemoData } from '../../../../lib/demo-flow'
import { championCrmOkSchema } from '../../../openapi'
import { runChampionCrmActionRoute } from '../../action-route'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['champion_crm.admin'] },
}

export async function POST(req: Request) {
  return runChampionCrmActionRoute(req, 'anna-hussar-demo', z.object({}).passthrough(), 'seed_demo_data', async (_input, ctx) => {
    const seeded = await seedChampionCrmDemoData(ctx.em, ctx)
    return {
      leadId: seeded.lead.id,
      investmentId: seeded.investment.id,
      apartmentIds: seeded.apartments.map((apartment) => apartment.id),
    }
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Champion CRM',
  summary: 'Seed Anna Kowalska / Hussar Loft demo data',
  methods: {
    POST: {
      summary: 'Seed Champion CRM demo data',
      responses: [{ status: 200, description: 'Demo data seeded', schema: championCrmOkSchema.passthrough() }],
    },
  },
}
