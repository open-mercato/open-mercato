import { z } from 'zod'
import { leadLinkPersonSchema } from '../../../data/validators'
import { runLeadAction } from '../runLeadAction'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customers.leads.link'] },
}

export async function POST(req: Request) {
  return runLeadAction(req, {
    commandId: 'customers.leads.link_person',
    schema: leadLinkPersonSchema,
  })
}

export const openApi = {
  tag: 'Customers',
  summary: 'Link a person to a lead',
  methods: {
    POST: {
      summary: 'Link a person to a lead',
      requestBody: { contentType: 'application/json', schema: leadLinkPersonSchema },
      responses: [{ status: 200, description: 'Person linked', schema: z.object({ ok: z.boolean() }) }],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
