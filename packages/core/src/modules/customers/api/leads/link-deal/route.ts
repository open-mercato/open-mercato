import { z } from 'zod'
import { leadLinkDealSchema } from '../../../data/validators'
import { runLeadAction } from '../runLeadAction'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customers.leads.link'] },
}

export async function POST(req: Request) {
  return runLeadAction(req, {
    commandId: 'customers.leads.link_deal',
    schema: leadLinkDealSchema,
  })
}

export const openApi = {
  tag: 'Customers',
  summary: 'Link a deal to a lead',
  methods: {
    POST: {
      summary: 'Link a deal to a lead',
      requestBody: { contentType: 'application/json', schema: leadLinkDealSchema },
      responses: [{ status: 200, description: 'Deal linked', schema: z.object({ ok: z.boolean() }) }],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
