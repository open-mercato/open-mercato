import { z } from 'zod'
import { leadAssignSchema } from '../../../data/validators'
import { runLeadAction } from '../runLeadAction'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customers.leads.assign'] },
}

export async function POST(req: Request) {
  return runLeadAction(req, {
    commandId: 'customers.leads.assign',
    schema: leadAssignSchema,
  })
}

export const openApi = {
  tag: 'Customers',
  summary: 'Assign a lead owner',
  methods: {
    POST: {
      summary: 'Assign a lead owner',
      requestBody: { contentType: 'application/json', schema: leadAssignSchema },
      responses: [{ status: 200, description: 'Lead assigned', schema: z.object({ ok: z.boolean() }) }],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
