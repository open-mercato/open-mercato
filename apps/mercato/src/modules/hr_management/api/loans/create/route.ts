import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runHrAction } from '../../payrollAction'
import { createLoanSchema } from '../../../data/validators'
import '../../../commands/payroll'

export const metadata = {
  path: '/hr_management/loans/create',
  POST: { requireAuth: true, requireFeatures: ['hr.write'] },
}

export async function POST(req: Request) {
  return runHrAction({
    req,
    schema: createLoanSchema,
    commandId: 'hr_management.loans.create',
    resourceKind: 'hr_management:hr_employee_loan',
    resolveResourceId: (input) => input.employeeId,
    fallbackError: 'Unable to create the loan',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'HR',
  summary: 'Create an employee loan',
  methods: {
    POST: {
      summary: 'Creates a loan and its instalment schedule',
      requestBody: { contentType: 'application/json', schema: createLoanSchema },
      responses: [{ status: 200, description: 'Created', schema: z.object({ id: z.string().uuid() }) }],
    },
  },
}
