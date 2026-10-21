import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runHrAction } from '../../payrollAction'
import { createPayrollRunSchema } from '../../../data/validators'
import '../../../commands/payroll'

export const metadata = {
  path: '/hr_management/payroll-runs/create',
  POST: { requireAuth: true, requireFeatures: ['hr.write'] },
}

export async function POST(req: Request) {
  return runHrAction({
    req,
    schema: createPayrollRunSchema,
    commandId: 'hr_management.payroll_runs.create',
    resourceKind: 'hr_management:hr_payroll_run',
    resolveResourceId: () => 'new',
    fallbackError: 'Unable to create the payroll run',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'HR',
  summary: 'Create a payroll run',
  methods: {
    POST: {
      summary: 'Creates a draft payroll run for a period',
      requestBody: { contentType: 'application/json', schema: createPayrollRunSchema },
      responses: [{ status: 200, description: 'Created', schema: z.object({ id: z.string().uuid() }) }],
    },
  },
}
