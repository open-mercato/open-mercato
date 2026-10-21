import { z } from 'zod'
import { leadAdvanceStageSchema } from '../../../data/validators'
import { runLeadAction } from '../runLeadAction'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customers.leads.stage'] },
}

export async function POST(req: Request) {
  return runLeadAction(req, {
    commandId: 'customers.leads.advance_stage',
    schema: leadAdvanceStageSchema,
  })
}

export const openApi = {
  tag: 'Customers',
  summary: 'Move a lead to another stage',
  methods: {
    POST: {
      summary: 'Move a lead to another stage',
      requestBody: { contentType: 'application/json', schema: leadAdvanceStageSchema },
      responses: [{ status: 200, description: 'Lead stage changed', schema: z.object({ ok: z.boolean() }) }],
      errors: [
        { status: 400, description: 'Invalid stage transition', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
