import { z } from 'zod'
import { leadCreateCompanySchema } from '../../../data/validators'
import { runLeadAction } from '../runLeadAction'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customers.leads.link'] },
}

export async function POST(req: Request) {
  return runLeadAction(req, {
    commandId: 'customers.leads.create_company',
    schema: leadCreateCompanySchema,
  })
}

export const openApi = {
  tag: 'Customers',
  summary: 'Create a company from lead data',
  methods: {
    POST: {
      summary: 'Create a company from lead data without closing the lead',
      requestBody: { contentType: 'application/json', schema: leadCreateCompanySchema },
      responses: [{ status: 200, description: 'Company created', schema: z.object({ ok: z.boolean(), companyId: z.string().uuid() }) }],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
