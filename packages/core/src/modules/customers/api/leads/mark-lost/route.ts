import { z } from 'zod'
import { leadMarkLostSchema } from '../../../data/validators'
import { runLeadAction } from '../runLeadAction'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customers.leads.stage'] },
}

export async function POST(req: Request) {
  return runLeadAction(req, {
    commandId: 'customers.leads.mark_lost',
    schema: leadMarkLostSchema,
  })
}

export const openApi = {
  tag: 'Customers',
  summary: 'Mark a lead lost',
  methods: {
    POST: {
      summary: 'Mark a lead lost with a reason',
      requestBody: { contentType: 'application/json', schema: leadMarkLostSchema },
      responses: [{ status: 200, description: 'Lead marked lost', schema: z.object({ ok: z.boolean() }) }],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
