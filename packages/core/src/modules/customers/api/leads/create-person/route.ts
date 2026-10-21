import { z } from 'zod'
import { leadCreatePersonSchema } from '../../../data/validators'
import { runLeadAction } from '../runLeadAction'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customers.leads.link'] },
}

export async function POST(req: Request) {
  return runLeadAction(req, {
    commandId: 'customers.leads.create_person',
    schema: leadCreatePersonSchema,
  })
}

export const openApi = {
  tag: 'Customers',
  summary: 'Create a person from lead data',
  methods: {
    POST: {
      summary: 'Create a person from lead data without closing the lead',
      requestBody: { contentType: 'application/json', schema: leadCreatePersonSchema },
      responses: [{ status: 200, description: 'Person created', schema: z.object({ ok: z.boolean(), personId: z.string().uuid() }) }],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
