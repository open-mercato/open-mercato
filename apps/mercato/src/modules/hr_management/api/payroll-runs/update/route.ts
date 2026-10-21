import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runHrAction } from '../../payrollAction'
import { updatePayrollRunSchema } from '../../../data/validators'
import '../../../commands/payroll'

export const metadata = {
  path: '/hr_management/payroll-runs/update',
  POST: { requireAuth: true, requireFeatures: ['hr.write'] },
}

export async function POST(req: Request) {
  return runHrAction({
    req,
    schema: updatePayrollRunSchema,
    commandId: 'hr_management.payroll_runs.update',
    resourceKind: 'hr_management:hr_payroll_run',
    resolveResourceId: (input) => input.id,
    fallbackError: 'Unable to update the payroll run',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'HR',
  summary: 'Update a draft payroll run',
  methods: {
    POST: {
      summary: 'Updates the payment date or notes on a draft run',
      requestBody: { contentType: 'application/json', schema: updatePayrollRunSchema },
      responses: [{ status: 200, description: 'Updated', schema: z.object({ id: z.string().uuid() }) }],
    },
  },
}
