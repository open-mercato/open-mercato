import { z } from 'zod'
import { leadLinkCompanySchema } from '../../../data/validators'
import { runLeadAction } from '../runLeadAction'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customers.leads.link'] },
}

export async function POST(req: Request) {
  return runLeadAction(req, {
    commandId: 'customers.leads.link_company',
    schema: leadLinkCompanySchema,
  })
}

export const openApi = {
  tag: 'Customers',
  summary: 'Link a company to a lead',
  methods: {
    POST: {
      summary: 'Link a company to a lead',
      requestBody: { contentType: 'application/json', schema: leadLinkCompanySchema },
      responses: [{ status: 200, description: 'Company linked', schema: z.object({ ok: z.boolean() }) }],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
