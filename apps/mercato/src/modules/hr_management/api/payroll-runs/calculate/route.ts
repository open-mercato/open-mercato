import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runHrAction } from '../../payrollAction'
import { calculatePayrollSchema } from '../../../data/validators'
import '../../../commands/payroll'

export const metadata = {
  path: '/hr_management/payroll-runs/calculate',
  POST: { requireAuth: true, requireFeatures: ['hr.write'] },
}

export async function POST(req: Request) {
  return runHrAction({
    req,
    schema: calculatePayrollSchema,
    commandId: 'hr_management.payroll_runs.calculate',
    resourceKind: 'hr_management:hr_payroll_run',
    resolveResourceId: (input) => input.id,
    fallbackError: 'Unable to calculate the payroll run',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'HR',
  summary: 'Calculate a payroll run',
  methods: {
    POST: {
      summary: 'Builds payslips and lines for the run period',
      requestBody: { contentType: 'application/json', schema: calculatePayrollSchema },
      responses: [{ status: 200, description: 'Calculated', schema: z.object({ id: z.string().uuid() }) }],
    },
  },
}
