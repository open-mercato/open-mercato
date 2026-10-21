import { z } from 'zod'
import { leadConvertSchema } from '../../../data/validators'
import { runLeadAction } from '../runLeadAction'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customers.leads.convert'] },
}

export async function POST(req: Request) {
  return runLeadAction(req, {
    commandId: 'customers.leads.convert',
    schema: leadConvertSchema,
  })
}

export const openApi = {
  tag: 'Customers',
  summary: 'Convert a lead',
  methods: {
    POST: {
      summary: 'Convert a lead into linked or newly created CRM records',
      requestBody: { contentType: 'application/json', schema: leadConvertSchema },
      responses: [{
        status: 200,
        description: 'Lead converted',
        schema: z.object({
          ok: z.boolean(),
          leadId: z.string().uuid(),
          personId: z.string().uuid().nullable(),
          companyId: z.string().uuid().nullable(),
          dealId: z.string().uuid().nullable(),
        }),
      }],
      errors: [
        { status: 400, description: 'Invalid target plan', schema: z.object({ error: z.string() }) },
        { status: 409, description: 'Lead already converted', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
