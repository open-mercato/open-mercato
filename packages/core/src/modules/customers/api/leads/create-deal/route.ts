import { z } from 'zod'
import { leadCreateDealSchema } from '../../../data/validators'
import { runLeadAction } from '../runLeadAction'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customers.leads.link'] },
}

export async function POST(req: Request) {
  return runLeadAction(req, {
    commandId: 'customers.leads.create_deal',
    schema: leadCreateDealSchema,
  })
}

export const openApi = {
  tag: 'Customers',
  summary: 'Create a deal from lead data',
  methods: {
    POST: {
      summary: 'Create a deal from lead data without closing the lead',
      requestBody: { contentType: 'application/json', schema: leadCreateDealSchema },
      responses: [{ status: 200, description: 'Deal created', schema: z.object({ ok: z.boolean(), dealId: z.string().uuid() }) }],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
